// Force IPv4 for DNS resolution (Render doesn't support IPv6 to Supabase)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Server: SocketIO } = require('socket.io');
const { db, pool } = require('./database');
const { initializeScheduler, refreshAllStocks, refreshEarnings, refreshAiDailyPicks } = require('./scheduler');
const { FinnhubWebSocketManager } = require('./websocket-manager');

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

const app = express();
const PORT = process.env.PORT || 3000;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Default stock symbols to show
const DEFAULT_SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX'];

// Simple cache for API responses
const cache = {};
const CACHE_TTL = 3600000; // 1 hour cache
const QUOTE_CACHE_TTL = 60000; // 1 minute for quotes (need fresher prices)

function getCached(key, ttl = CACHE_TTL) {
  const entry = cache[key];
  if (entry && Date.now() - entry.time < ttl) {
    return entry.data;
  }
  return null;
}

function setCache(key, data) {
  cache[key] = { data, time: Date.now() };
}

// Rate limiter for Finnhub API (free tier: 60 calls/minute)
const requestQueue = [];
let activeRequests = 0;
const MAX_REQUESTS_PER_MINUTE = 55; // stay under 60 limit
const requestTimestamps = [];

function canMakeRequest() {
  const now = Date.now();
  // Remove timestamps older than 1 minute
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > 60000) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < MAX_REQUESTS_PER_MINUTE;
}

function waitForSlot() {
  return new Promise((resolve) => {
    const check = () => {
      if (canMakeRequest()) {
        requestTimestamps.push(Date.now());
        resolve();
      } else {
        const waitTime = 60000 - (Date.now() - requestTimestamps[0]) + 100;
        setTimeout(check, Math.min(waitTime, 2000));
      }
    };
    check();
  });
}

// Helper function to make Finnhub API requests with caching and rate limiting
async function finnhubRequest(endpoint, params = {}) {
  const cacheKey = endpoint + JSON.stringify(params);
  // Use shorter TTL for quotes, longer for everything else
  const ttl = endpoint === '/quote' ? QUOTE_CACHE_TTL : CACHE_TTL;
  const cached = getCached(cacheKey, ttl);
  if (cached) return cached;

  // Wait for rate limit slot
  await waitForSlot();

  try {
    const response = await axios.get(`${FINNHUB_BASE_URL}${endpoint}`, {
      params: {
        ...params,
        token: FINNHUB_API_KEY
      }
    });
    setCache(cacheKey, response.data);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.warn('Finnhub rate limit hit, waiting 10s and retrying...');
      await new Promise(r => setTimeout(r, 10000));
      return finnhubRequest(endpoint, params); // retry once
    }
    console.error('Finnhub API Error:', error.message);
    // Return cached data even if expired, rather than failing
    const stale = cache[cacheKey];
    if (stale) return stale.data;
    throw error;
  }
}

// Get stock quote (real-time price)
async function getStockQuote(symbol) {
  return await finnhubRequest('/quote', { symbol });
}

// Get company profile
async function getCompanyProfile(symbol) {
  return await finnhubRequest('/stock/profile2', { symbol });
}

// Transform database record to API format
function transformStockData(dbStock) {
  const quote = typeof dbStock.quote === 'string' ? JSON.parse(dbStock.quote) : dbStock.quote || {};
  const profile = typeof dbStock.company_profile === 'string' ? JSON.parse(dbStock.company_profile) : dbStock.company_profile || {};

  return {
    symbol: dbStock.symbol,
    name: profile.name || dbStock.display_symbol || dbStock.symbol,
    price: quote.c || 0,
    change: quote.d || 0,
    changePercent: quote.dp || 0,
    high: quote.h || 0,
    low: quote.l || 0,
    open: quote.o || 0,
    previousClose: quote.pc || 0,
    volume: profile.shareOutstanding || 0,
    marketCap: profile.marketCapitalization ? `${(profile.marketCapitalization / 1000).toFixed(1)}B` : 'N/A'
  };
}

// Fetch and store stock data
async function fetchAndStoreStock(symbol) {
  try {
    const [quote, profile] = await Promise.all([
      getStockQuote(symbol),
      getCompanyProfile(symbol)
    ]);

    await db.upsertStock({
      symbol: symbol,
      displaySymbol: symbol,
      assetType: 'Common Stock',
      sector: profile.finnhubIndustry || null,
      currency: profile.currency || 'USD',
      companyProfile: profile,
      quote: quote
    });

    return {
      symbol: symbol,
      name: profile.name || symbol,
      price: quote.c || 0,
      change: quote.d || 0,
      changePercent: quote.dp || 0,
      high: quote.h || 0,
      low: quote.l || 0,
      open: quote.o || 0,
      previousClose: quote.pc || 0,
      volume: profile.shareOutstanding || 0,
      marketCap: profile.marketCapitalization ? `${(profile.marketCapitalization / 1000).toFixed(1)}B` : 'N/A'
    };
  } catch (error) {
    console.error(`Error fetching and storing ${symbol}:`, error.message);
    return null;
  }
}

// API Routes

// Get list of stocks from database watchlist
app.get('/api/stocks', async (req, res) => {
  try {
    // Get stocks from database
    let stocks = await db.getWatchlist();

    // If no stocks in database, add default ones
    if (stocks.length === 0) {
      console.log('No stocks in database, adding defaults...');
      const stocksData = await Promise.all(
        DEFAULT_SYMBOLS.map(symbol => fetchAndStoreStock(symbol))
      );
      stocks = await db.getWatchlist();
    }

    // Transform to API format
    const transformedStocks = stocks.map(transformStockData).filter(s => s !== null);
    res.json(transformedStocks);
  } catch (error) {
    console.error('Error fetching stocks:', error);
    res.status(500).json({ error: 'Failed to fetch stock data' });
  }
});

// Get single stock detail
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    // Check if stock exists in database
    let dbStock = await db.getStockBySymbol(upperSymbol);

    // If not in database, fetch from API and store
    if (!dbStock) {
      console.log(`Stock ${upperSymbol} not in database, fetching from API...`);
      const stockData = await fetchAndStoreStock(upperSymbol);
      if (!stockData) {
        return res.status(404).json({ error: 'Stock not found' });
      }
      return res.json(stockData);
    }

    // Stock exists in database, return it
    const transformedStock = transformStockData(dbStock);
    res.json(transformedStock);
  } catch (error) {
    console.error('Error fetching stock detail:', error);
    res.status(500).json({ error: 'Failed to fetch stock detail' });
  }
});

// Get detailed stock info (company profile, sector, earnings, analyst recommendations)
app.get('/api/stock/:symbol/details', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    // Fetch company profile, recommendations, and 52-week candles in parallel
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - (365 * 24 * 60 * 60);
    const [profile, recommendations, candles, metrics] = await Promise.all([
      finnhubRequest('/stock/profile2', { symbol }),
      finnhubRequest('/stock/recommendation', { symbol }).catch(() => []),
      finnhubRequest('/stock/candle', { symbol, resolution: 'W', from: oneYearAgo, to: now }).catch(() => null),
      finnhubRequest('/stock/metric', { symbol, metric: 'all' }).catch(() => null)
    ]);

    // Calculate 52-week high/low from candle data
    let week52High = null;
    let week52Low = null;
    if (candles && candles.s !== 'no_data' && candles.h && candles.l) {
      week52High = Math.max(...candles.h);
      week52Low = Math.min(...candles.l);
    }

    // Get next earnings date from database
    const todayStr = new Date().toISOString().split('T')[0];
    let nextEarnings = null;
    try {
      const earningsResult = await pool.query(
        `SELECT "Date" FROM "Earnings" WHERE "Symbol" = $1 AND "Date" >= $2 ORDER BY "Date" ASC LIMIT 1`,
        [symbol, todayStr]
      );
      if (earningsResult.rows.length > 0) {
        nextEarnings = earningsResult.rows[0].Date;
      }
    } catch (e) {
      // Earnings table may not have data for this symbol
    }

    // Get latest recommendation (most recent period)
    const latestRec = recommendations.length > 0 ? recommendations[0] : null;

    res.json({
      description: profile.description || null,
      sector: profile.finnhubIndustry || null,
      country: profile.country || null,
      marketCap: profile.marketCapitalization || null,
      logo: profile.logo || null,
      weburl: profile.weburl || null,
      ipo: profile.ipo || null,
      week52High: week52High,
      week52Low: week52Low,
      epsTTM: metrics?.metric?.epsTTM || null,
      peRatio: metrics?.metric?.peAnnual || null,
      nextEarnings: nextEarnings,
      recommendation: latestRec ? {
        buy: latestRec.buy || 0,
        hold: latestRec.hold || 0,
        sell: latestRec.sell || 0,
        strongBuy: latestRec.strongBuy || 0,
        strongSell: latestRec.strongSell || 0,
        period: latestRec.period || null
      } : null
    });
  } catch (error) {
    console.error('Error fetching stock details:', error);
    res.status(500).json({ error: 'Failed to fetch stock details' });
  }
});

// Add stock to watchlist
app.post('/api/watchlist', async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    const upperSymbol = symbol.toUpperCase();

    // Check if already exists
    const exists = await db.stockExists(upperSymbol);
    if (exists) {
      return res.status(400).json({ error: 'Stock already in watchlist' });
    }

    // Fetch and store
    const stockData = await fetchAndStoreStock(upperSymbol);
    if (!stockData) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    res.json({ message: 'Stock added to watchlist', stock: stockData });
  } catch (error) {
    console.error('Error adding to watchlist:', error);
    res.status(500).json({ error: 'Failed to add stock to watchlist' });
  }
});

// Remove stock from watchlist
app.delete('/api/watchlist/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const removed = await db.removeStock(symbol.toUpperCase());

    if (!removed) {
      return res.status(404).json({ error: 'Stock not found in watchlist' });
    }

    res.json({ message: 'Stock removed from watchlist', symbol: symbol.toUpperCase() });
  } catch (error) {
    console.error('Error removing from watchlist:', error);
    res.status(500).json({ error: 'Failed to remove stock from watchlist' });
  }
});

// Refresh stock data (fetch latest from API)
app.post('/api/stock/:symbol/refresh', async (req, res) => {
  try {
    const { symbol } = req.params;
    const stockData = await fetchAndStoreStock(symbol.toUpperCase());

    if (!stockData) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    res.json({ message: 'Stock data refreshed', stock: stockData });
  } catch (error) {
    console.error('Error refreshing stock:', error);
    res.status(500).json({ error: 'Failed to refresh stock data' });
  }
});

// Get stock historical data (candles)
app.get('/api/stock/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { days = 30 } = req.query;

    const to = Math.floor(Date.now() / 1000);
    const from = to - (parseInt(days) * 24 * 60 * 60);

    const candles = await finnhubRequest('/stock/candle', {
      symbol: symbol.toUpperCase(),
      resolution: 'D',
      from: from,
      to: to
    });

    if (candles.s === 'no_data') {
      return res.json([]);
    }

    const history = candles.t.map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().split('T')[0],
      price: candles.c[index]
    }));

    res.json(history);
  } catch (error) {
    console.error('Error fetching stock history:', error);
    res.status(500).json({ error: 'Failed to fetch stock history' });
  }
});

// Search stocks
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await finnhubRequest('/search', { q: query });

    const filteredResults = results.result
      .filter(item => item.type === 'Common Stock' && item.symbol.indexOf('.') === -1)
      .slice(0, 10)
      .map(item => ({
        symbol: item.symbol,
        name: item.description
      }));

    res.json(filteredResults);
  } catch (error) {
    console.error('Error searching stocks:', error);
    res.status(500).json({ error: 'Failed to search stocks' });
  }
});

// Sentiment analysis based on headline and summary keywords
function analyzeSentiment(headline, summary) {
  const text = ((headline || '') + ' ' + (summary || '')).toLowerCase();

  const positiveWords = [
    'surge', 'surges', 'surging', 'rally', 'rallies', 'rallying',
    'gain', 'gains', 'rise', 'rises', 'rising', 'jump', 'jumps',
    'soar', 'soars', 'soaring', 'climb', 'climbs', 'climbing',
    'boost', 'boosts', 'record high', 'all-time high', 'bullish',
    'upgrade', 'upgrades', 'outperform', 'beat', 'beats', 'beating',
    'strong', 'growth', 'profit', 'profits', 'profitable',
    'optimistic', 'optimism', 'recover', 'recovery', 'rebound',
    'positive', 'upbeat', 'breakthrough', 'success', 'successful',
    'buy', 'overweight', 'opportunity', 'opportunities', 'up '
  ];

  const negativeWords = [
    'drop', 'drops', 'dropping', 'fall', 'falls', 'falling',
    'decline', 'declines', 'declining', 'plunge', 'plunges', 'plunging',
    'crash', 'crashes', 'crashing', 'tumble', 'tumbles', 'tumbling',
    'sell-off', 'selloff', 'bearish', 'downgrade', 'downgrades',
    'loss', 'losses', 'losing', 'lose', 'weak', 'weakness',
    'miss', 'misses', 'missed', 'underperform', 'cut', 'cuts',
    'fear', 'fears', 'concern', 'concerns', 'worried', 'worry',
    'risk', 'risks', 'crisis', 'recession', 'layoff', 'layoffs',
    'warning', 'warns', 'threat', 'threats', 'down ', 'negative',
    'slump', 'slumps', 'tank', 'tanks', 'sell', 'underweight',
    'tariff', 'tariffs', 'inflation', 'debt', 'default', 'bankrupt'
  ];

  let score = 0;
  for (const word of positiveWords) {
    if (text.includes(word)) score++;
  }
  for (const word of negativeWords) {
    if (text.includes(word)) score--;
  }

  if (score > 0) return { sentiment: 'positive', label: 'Positive' };
  if (score < 0) return { sentiment: 'negative', label: 'Negative' };
  return { sentiment: 'neutral', label: 'Neutral' };
}

// Get market news
app.get('/api/news', async (req, res) => {
  try {
    const { category = 'general' } = req.query;

    // Fetch directly from Finnhub (bypass cache for fresh news)
    const response = await axios.get(`${FINNHUB_BASE_URL}/news`, {
      params: { category, token: FINNHUB_API_KEY }
    });
    const news = response.data;

    // Sort by datetime descending (most recent first) and take top 30
    const sorted = [...news].sort((a, b) => b.datetime - a.datetime);
    const transformedNews = sorted.slice(0, 30).map(item => {
      const { sentiment, label } = analyzeSentiment(item.headline, item.summary);
      return {
        title: item.headline,
        source: item.source,
        time: getTimeAgo(item.datetime),
        url: item.url,
        summary: item.summary,
        image: item.image,
        datetime: item.datetime,
        sentiment,
        sentimentLabel: label
      };
    });

    res.json(transformedNews);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Get company-specific news
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const from = new Date();
    from.setDate(from.getDate() - 7); // Last 7 days
    const to = new Date();

    const news = await finnhubRequest('/company-news', {
      symbol: symbol.toUpperCase(),
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0]
    });

    // Transform and limit to top 10 news items
    const transformedNews = news.slice(0, 10).map(item => {
      const { sentiment, label } = analyzeSentiment(item.headline, item.summary);
      return {
        title: item.headline,
        source: item.source,
        time: getTimeAgo(item.datetime),
        url: item.url,
        summary: item.summary,
        image: item.image,
        datetime: item.datetime,
        sentiment,
        sentimentLabel: label
      };
    });

    res.json(transformedNews);
  } catch (error) {
    console.error('Error fetching company news:', error);
    res.status(500).json({ error: 'Failed to fetch company news' });
  }
});

// Helper function to convert timestamp to "time ago" format
function getTimeAgo(timestamp) {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

// Market indices endpoint (S&P 500, Nasdaq, Dow Jones via ETF proxies)
const MARKET_INDICES = [
  { symbol: 'SPY', name: 'S&P 500', etf: true },
  { symbol: 'QQQ', name: 'Nasdaq', etf: true },
  { symbol: 'DIA', name: 'Dow Jones', etf: true },
  { symbol: 'IWM', name: 'Russell 2000', etf: true }
];

app.get('/api/market-indices', async (req, res) => {
  try {
    const indices = await Promise.all(
      MARKET_INDICES.map(async (index) => {
        try {
          const quote = await finnhubRequest('/quote', { symbol: index.symbol });
          return {
            symbol: index.symbol,
            name: index.name,
            price: quote.c || 0,
            change: quote.d || 0,
            changePercent: quote.dp || 0,
            high: quote.h || 0,
            low: quote.l || 0,
            open: quote.o || 0,
            previousClose: quote.pc || 0
          };
        } catch (err) {
          return { symbol: index.symbol, name: index.name, price: 0, change: 0, changePercent: 0 };
        }
      })
    );
    res.json(indices);
  } catch (error) {
    console.error('Error fetching market indices:', error);
    res.status(500).json({ error: 'Failed to fetch market indices' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Stock market API is running',
    database: 'connected',
    scheduler: scheduler ? scheduler.getStatus() : { enabled: false }
  });
});

// Manual refresh endpoint
app.post('/api/refresh-all', async (req, res) => {
  try {
    console.log('Manual refresh triggered via API');
    await refreshAllStocks();
    res.json({
      success: true,
      message: 'Stock data refresh completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in manual refresh:', error);
    res.status(500).json({ error: 'Failed to refresh stock data' });
  }
});

// Scheduler control endpoints
app.post('/api/scheduler/start-market-hours', (req, res) => {
  if (scheduler) {
    scheduler.startMarketHoursUpdates();
    res.json({ message: 'Market hours updates enabled' });
  } else {
    res.status(500).json({ error: 'Scheduler not initialized' });
  }
});

app.post('/api/scheduler/stop-market-hours', (req, res) => {
  if (scheduler) {
    scheduler.stopMarketHoursUpdates();
    res.json({ message: 'Market hours updates disabled' });
  } else {
    res.status(500).json({ error: 'Scheduler not initialized' });
  }
});

app.get('/api/scheduler/status', (req, res) => {
  if (scheduler) {
    res.json(scheduler.getStatus());
  } else {
    res.status(500).json({ error: 'Scheduler not initialized' });
  }
});

// AI Daily Picks — external cron trigger (GET so free cron services can hit it)
app.get('/api/ai-picks/trigger', async (req, res) => {
  const secret = req.query.key;
  if (secret !== (process.env.CRON_SECRET || 'stockpicks2026')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    console.log('🤖 AI Daily Picks triggered by external cron');
    res.json({ message: 'AI Daily Picks batch started', timestamp: new Date().toISOString() });
    // Run in background so the response returns immediately
    refreshAiDailyPicks().catch(err => console.error('Batch error:', err));
  } catch (error) {
    console.error('Error triggering AI picks:', error);
    res.status(500).json({ error: 'Failed to trigger AI picks' });
  }
});

// AI Daily Picks endpoint with filtering
app.get('/api/recommendations/daily', async (req, res) => {
  try {
    const {
      priceMin,
      priceMax,
      category,
      sortBy = 'ai_score',
      limit = '50',
      offset = '0'
    } = req.query;

    const picks = await db.getAiDailyPicks({
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      category: category || null,
      sortBy,
      limit: Math.min(parseInt(limit), 200),
      offset: parseInt(offset)
    });

    const totalCount = await db.getAiPicksTotalCount({
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      category: category || null
    });

    res.json({
      date: picks.length > 0 ? picks[0].pick_date : new Date().toISOString().split('T')[0],
      picks,
      totalCount,
      categories: ['Low-Cost Opportunities', 'Mid-Cap Momentum', 'High-Value Premium', 'Breakout Candidates']
    });
  } catch (error) {
    console.error('Error fetching AI daily picks:', error);
    res.status(500).json({ error: 'Failed to fetch AI daily picks' });
  }
});

// Authentication endpoints

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, accessCode, firstName, lastName } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await db.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user (default AccessCode 10 = Full access)
    const user = await db.createUser(email, hashedPassword, accessCode || 10, firstName || null, lastName || null);

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        accessCode: user.AccessCode
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        accessCode: user.AccessCode,
        subscriptionEnd: user.SubscriptionEnd,
        firstName: user.FirstName,
        lastName: user.LastName
      }
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Email not found. Please sign up to create an account.', code: 'USER_NOT_FOUND' });
    }

    // Check if user is active
    if (!user.IsActive) {
      return res.status(403).json({ error: 'Account is inactive. Please contact support.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.', code: 'INVALID_PASSWORD' });
    }

    // Check subscription
    const now = new Date();
    const subscriptionEnd = new Date(user.SubscriptionEnd);
    const isSubscriptionActive = subscriptionEnd > now;

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        accessCode: user.AccessCode
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        accessCode: user.AccessCode,
        subscriptionEnd: user.SubscriptionEnd,
        isSubscriptionActive,
        firstName: user.FirstName,
        lastName: user.LastName
      }
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Verify token (optional - for checking if user is still authenticated)
app.get('/api/auth/verify', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Forgot password - send reset link via email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const user = await db.findUserByEmail(email);
    if (!user) {
      // Return success even if user not found (security: don't reveal which emails exist)
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store token in database
    await db.createPasswordResetToken(email, resetToken, expiresAt);

    // Build reset link
    const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Send email
    await transporter.sendMail({
      from: `"Stock Market App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px;">
          <h2 style="color: #1a1a1a; margin-bottom: 20px;">Password Reset</h2>
          <p style="color: #333; font-size: 1rem; line-height: 1.6;">
            Hi ${user.FirstName || 'there'},
          </p>
          <p style="color: #333; font-size: 1rem; line-height: 1.6;">
            We received a request to reset your password. Click the button below to create a new password:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1rem;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 0.9rem; line-height: 1.6;">
            This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
          <p style="color: #999; font-size: 0.8rem;">Stock Market App</p>
        </div>
      `
    });

    console.log(`Password reset email sent to ${email}`);
    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Error in forgot password:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Find valid token
    const resetRecord = await db.findValidResetToken(token);
    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await db.updateUserPassword(resetRecord.email, hashedPassword);

    // Mark token as used
    await db.markTokenUsed(token);

    console.log(`Password reset successful for ${resetRecord.email}`);
    res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Validate reset token (check if token is still valid)
app.get('/api/auth/validate-reset-token', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token is required' });
    }

    const resetRecord = await db.findValidResetToken(token);
    if (!resetRecord) {
      return res.json({ valid: false });
    }

    res.json({ valid: true, email: resetRecord.email });
  } catch (error) {
    res.status(500).json({ valid: false, error: 'Failed to validate token' });
  }
});

// JWT auth middleware
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// User stock trades endpoints

// Get user's stock trades
app.get('/api/trades', authenticateToken, async (req, res) => {
  try {
    const trades = await db.getUserStockTrades(req.user.userId);
    res.json(trades);
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// Add a stock trade
app.post('/api/trades', authenticateToken, async (req, res) => {
  try {
    const { symbol, currentPrice } = req.body;

    if (!symbol || !currentPrice) {
      return res.status(400).json({ error: 'Symbol and current price are required' });
    }

    // Check if already exists
    const exists = await db.userStockTradeExists(req.user.userId, symbol);
    if (exists) {
      return res.status(400).json({ error: 'Stock already in your trade list' });
    }

    const trade = await db.addUserStockTrade(req.user.userId, symbol, currentPrice);
    res.status(201).json(trade);

    // Fetch earnings for this stock in the background (so smaller stocks aren't missed)
    const upperSymbol = symbol.toUpperCase();
    const todayStr = new Date().toISOString().split('T')[0];
    const threeMonthsOut = new Date();
    threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);
    const toStr = threeMonthsOut.toISOString().split('T')[0];

    finnhubRequest('/calendar/earnings', { symbol: upperSymbol, from: todayStr, to: toStr })
      .then(async (data) => {
        if (data && data.earningsCalendar && data.earningsCalendar.length > 0) {
          const earnings = data.earningsCalendar.map(item => ({
            symbol: item.symbol,
            date: item.date,
            epsActual: item.epsActual || null,
            epsEstimate: item.epsEstimate || null,
            time: item.hour || null,
            revenueActual: item.revenueActual || null,
            revenueEstimate: item.revenueEstimate || null,
            year: item.year || new Date(item.date).getFullYear()
          }));
          await db.initializeEarningsConstraint();
          await db.bulkInsertEarnings(earnings);
          console.log(`📅 Auto-fetched ${earnings.length} earnings entries for ${upperSymbol}`);
        }
      })
      .catch(err => console.error(`Failed to auto-fetch earnings for ${upperSymbol}:`, err.message));
  } catch (error) {
    console.error('Error adding trade:', error);
    res.status(500).json({ error: 'Failed to add trade' });
  }
});

// Delete a stock trade
app.delete('/api/trades/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;

    // Check if trade has shares — if no shares, hard delete; otherwise soft delete
    const trade = await db.getUserStockTrade(req.user.userId, symbol);
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    let deleted;
    if (!trade.shares || trade.shares === 0) {
      // No shares entered — hard delete from database
      deleted = await db.hardDeleteUserStockTrade(req.user.userId, symbol);
    } else {
      // Has shares — soft delete to preserve P&L data
      deleted = await db.deleteUserStockTrade(req.user.userId, symbol);
    }

    res.json({ message: 'Trade removed successfully', trade: deleted });
  } catch (error) {
    console.error('Error deleting trade:', error);
    res.status(500).json({ error: 'Failed to delete trade' });
  }
});

// Update a stock trade (buy price, shares, sell price)
app.patch('/api/trades/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { buyPrice, shares, sellPrice } = req.body;

    // If buyPrice is provided, update targets too
    if (buyPrice && buyPrice > 0) {
      await db.updateUserStockTrade(req.user.userId, symbol, buyPrice);
    }

    // Update shares and/or sell price if provided
    if (shares !== undefined || sellPrice !== undefined) {
      await db.updateTradeFields(req.user.userId, symbol, shares, sellPrice);
    }

    // Return the updated record
    const updated = await db.getUserStockTrade(req.user.userId, symbol);
    if (!updated) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating trade:', error);
    res.status(500).json({ error: 'Failed to update trade' });
  }
});

// Monthly P&L endpoint
app.get('/api/trades/monthly-pl', authenticateToken, async (req, res) => {
  try {
    const result = await db.getMonthlyPL(req.user.userId);
    res.json(result);
  } catch (error) {
    console.error('Error fetching monthly P&L:', error);
    res.status(500).json({ error: 'Failed to fetch monthly P&L' });
  }
});

// Trade history (closed positions)
app.get('/api/trades/history', authenticateToken, async (req, res) => {
  try {
    const history = await db.getTradeHistory(req.user.userId);
    res.json(history);
  } catch (error) {
    console.error('Error fetching trade history:', error);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// Options chain from Finnhub (direct call, bypasses rate limiter due to large response size)
app.get('/api/options-chain/:symbol', authenticateToken, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    console.log(`Fetching options chain for ${symbol}...`);
    const response = await axios.get(`${FINNHUB_BASE_URL}/stock/option-chain`, {
      params: { symbol, token: FINNHUB_API_KEY },
      timeout: 30000
    });
    console.log(`Options chain for ${symbol}: ${response.data?.data?.length || 0} expiries`);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching options chain:', error.message);
    res.status(500).json({ error: 'Failed to fetch options chain' });
  }
});

// User option trades endpoints

// Get user's option trades
app.get('/api/option-trades', authenticateToken, async (req, res) => {
  try {
    const trades = await db.getUserOptionTrades(req.user.userId);
    res.json(trades);
  } catch (error) {
    console.error('Error fetching option trades:', error);
    res.status(500).json({ error: 'Failed to fetch option trades' });
  }
});

// Add an option trade
app.post('/api/option-trades', authenticateToken, async (req, res) => {
  try {
    const { symbol, optionType, strike, expiry, premiumPaid, contracts, side } = req.body;

    if (!symbol || !optionType || !strike || !expiry || !premiumPaid) {
      return res.status(400).json({ error: 'Symbol, option type, strike, expiry, and premium are required' });
    }

    if (!['Call', 'Put'].includes(optionType)) {
      return res.status(400).json({ error: 'Option type must be Call or Put' });
    }

    if (side && !['Buy', 'Sell'].includes(side)) {
      return res.status(400).json({ error: 'Side must be Buy or Sell' });
    }

    const trade = await db.addUserOptionTrade(req.user.userId, {
      symbol, optionType, strike, expiry, premiumPaid, contracts: contracts || 1, side: side || 'Buy'
    });
    res.status(201).json(trade);
  } catch (error) {
    console.error('Error adding option trade:', error);
    res.status(500).json({ error: 'Failed to add option trade' });
  }
});

// Delete an option trade (soft delete)
app.delete('/api/option-trades/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.deleteUserOptionTrade(req.user.userId, id);
    if (!deleted) {
      return res.status(404).json({ error: 'Option trade not found' });
    }
    res.json({ message: 'Option trade removed', trade: deleted });
  } catch (error) {
    console.error('Error deleting option trade:', error);
    res.status(500).json({ error: 'Failed to delete option trade' });
  }
});

// Update an option trade
app.patch('/api/option-trades/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { premiumPaid, contracts, strike } = req.body;
    const updated = await db.updateOptionTradeFields(req.user.userId, id, { premiumPaid, contracts, strike });
    if (!updated) {
      return res.status(404).json({ error: 'Option trade not found or no fields to update' });
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating option trade:', error);
    res.status(500).json({ error: 'Failed to update option trade' });
  }
});

// Metric explanations endpoint
app.get('/api/metric-explanations', async (req, res) => {
  try {
    const explanations = await db.getMetricExplanations();
    res.json(explanations);
  } catch (error) {
    console.error('Error fetching metric explanations:', error);
    res.status(500).json({ error: 'Failed to fetch metric explanations' });
  }
});

// Earnings endpoints

// Get monthly earnings — optionally filtered by symbol list
app.get('/api/earnings/monthly', async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const fromDate = req.query.from || firstDay.toISOString().split('T')[0];
    const toDate = req.query.to || lastDay.toISOString().split('T')[0];
    const symbolsParam = req.query.symbols; // comma-separated

    let earnings;
    if (symbolsParam) {
      const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      earnings = await db.getEarningsBySymbols(fromDate, toDate, symbols);
    } else {
      earnings = await db.getEarnings(fromDate, toDate);
    }
    res.json({ fromDate, toDate, earnings });
  } catch (error) {
    console.error('Error fetching monthly earnings:', error);
    res.status(500).json({ error: 'Failed to fetch monthly earnings' });
  }
});

// Manually trigger earnings refresh
app.post('/api/earnings/refresh', authenticateToken, async (req, res) => {
  try {
    await refreshEarnings();
    res.json({ message: 'Earnings refresh triggered successfully' });
  } catch (error) {
    console.error('Error refreshing earnings:', error);
    res.status(500).json({ error: 'Failed to refresh earnings' });
  }
});

// Get user's custom earnings symbols
app.get('/api/earnings/user-symbols', authenticateToken, async (req, res) => {
  try {
    const symbols = await db.getUserEarningsSymbols(req.user.userId);
    res.json(symbols);
  } catch (error) {
    console.error('Error fetching user earnings symbols:', error);
    res.status(500).json({ error: 'Failed to fetch earnings symbols' });
  }
});

// Add a symbol to user's earnings tracking
app.post('/api/earnings/symbols', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const upperSymbol = symbol.toUpperCase();

    // Add to user's earnings symbols list
    await db.addUserEarningsSymbol(req.user.userId, upperSymbol);

    // Check if earnings exist in DB for next 3 months
    const todayStr = new Date().toISOString().split('T')[0];
    const threeMonthsOut = new Date();
    threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);
    const toStr = threeMonthsOut.toISOString().split('T')[0];

    const existing = await db.getEarningsBySymbols(todayStr, toStr, [upperSymbol]);

    if (existing.length === 0) {
      // Fetch from Finnhub and insert
      try {
        const data = await finnhubRequest('/calendar/earnings', {
          symbol: upperSymbol,
          from: todayStr,
          to: toStr
        });

        if (data && data.earningsCalendar && data.earningsCalendar.length > 0) {
          const earnings = data.earningsCalendar.map(item => ({
            symbol: item.symbol,
            date: item.date,
            epsActual: item.epsActual || null,
            epsEstimate: item.epsEstimate || null,
            time: item.hour || null,
            revenueActual: item.revenueActual || null,
            revenueEstimate: item.revenueEstimate || null,
            year: item.year || new Date(item.date).getFullYear()
          }));
          await db.initializeEarningsConstraint();
          await db.bulkInsertEarnings(earnings);
          console.log(`📅 Fetched ${earnings.length} earnings for ${upperSymbol} (user request)`);
        }
      } catch (err) {
        console.error(`Failed to fetch earnings for ${upperSymbol}:`, err.message);
      }
    }

    res.json({ message: 'Symbol added to earnings tracking', symbol: upperSymbol });
  } catch (error) {
    console.error('Error adding earnings symbol:', error);
    res.status(500).json({ error: 'Failed to add earnings symbol' });
  }
});

// Remove a symbol from user's earnings tracking
app.delete('/api/earnings/symbols/:symbol', authenticateToken, async (req, res) => {
  try {
    const { symbol } = req.params;
    await db.removeUserEarningsSymbol(req.user.userId, symbol.toUpperCase());
    res.json({ message: 'Symbol removed from earnings tracking', symbol: symbol.toUpperCase() });
  } catch (error) {
    console.error('Error removing earnings symbol:', error);
    res.status(500).json({ error: 'Failed to remove earnings symbol' });
  }
});

// Earnings analysis for a specific symbol
app.get('/api/earnings/analysis/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    // Fetch data in parallel: EPS history from DB, recommendations + metrics + profile from Finnhub
    const [epsHistory, recommendations, metrics, profile] = await Promise.all([
      db.getEarningsHistory(symbol),
      finnhubRequest('/stock/recommendation', { symbol }).catch(() => []),
      finnhubRequest('/stock/metric', { symbol, metric: 'all' }).catch(() => null),
      finnhubRequest('/stock/profile2', { symbol }).catch(() => ({}))
    ]);

    // Calculate beat/miss stats
    let beats = 0;
    let totalSurprise = 0;
    const history = epsHistory.map(e => {
      const actual = parseFloat(e.EpsActual);
      const estimate = parseFloat(e.EpsEstimate);
      const surprise = estimate !== 0 ? ((actual - estimate) / Math.abs(estimate)) * 100 : 0;
      if (actual >= estimate) beats++;
      totalSurprise += surprise;
      return {
        date: e.Date,
        actual,
        estimate,
        surprise: +surprise.toFixed(2),
        beat: actual >= estimate
      };
    });

    const beatRate = history.length > 0 ? Math.round((beats / history.length) * 100) : null;
    const avgSurprise = history.length > 0 ? +(totalSurprise / history.length).toFixed(2) : null;

    // Latest analyst recommendation
    const latestRec = recommendations.length > 0 ? recommendations[0] : null;
    const recommendation = latestRec ? {
      strongBuy: latestRec.strongBuy || 0,
      buy: latestRec.buy || 0,
      hold: latestRec.hold || 0,
      sell: latestRec.sell || 0,
      strongSell: latestRec.strongSell || 0
    } : null;

    const epsTTM = metrics?.metric?.epsTTM || null;
    const peRatio = metrics?.metric?.peAnnual || null;

    // Get next earnings date and current estimate
    const todayStr = new Date().toISOString().split('T')[0];
    let nextEarnings = null;
    let currentEstimate = null;
    try {
      const earningsResult = await pool.query(
        `SELECT "Date", "EpsEstimate" FROM "Earnings" WHERE "Symbol" = $1 AND "Date" >= $2 ORDER BY "Date" ASC LIMIT 1`,
        [symbol, todayStr]
      );
      if (earningsResult.rows.length > 0) {
        nextEarnings = earningsResult.rows[0].Date;
        currentEstimate = earningsResult.rows[0].EpsEstimate ? parseFloat(earningsResult.rows[0].EpsEstimate) : null;
      }
    } catch (e) { /* ignore */ }

    // Rule-based outlook scoring
    let score = 0;
    const reasons = [];

    if (beatRate !== null) {
      if (beatRate > 70) { score += 2; reasons.push(`Beat estimates ${beatRate}% of quarters`); }
      else if (beatRate > 50) { score += 1; reasons.push(`Beat estimates ${beatRate}% of quarters`); }
      else if (beatRate < 30) { score -= 2; reasons.push(`Missed estimates ${100 - beatRate}% of quarters`); }
      else { reasons.push(`Beat estimates ${beatRate}% of quarters`); }
    }

    if (recommendation) {
      const totalAnalysts = recommendation.strongBuy + recommendation.buy + recommendation.hold + recommendation.sell + recommendation.strongSell;
      const buyRatio = totalAnalysts > 0 ? (recommendation.strongBuy + recommendation.buy) / totalAnalysts : 0;
      const sellRatio = totalAnalysts > 0 ? (recommendation.sell + recommendation.strongSell) / totalAnalysts : 0;
      if (buyRatio > 0.6) { score += 2; reasons.push(`Analysts: ${recommendation.strongBuy + recommendation.buy} Buy vs ${recommendation.sell + recommendation.strongSell} Sell`); }
      else if (buyRatio > 0.4) { score += 1; reasons.push(`Analysts: ${recommendation.strongBuy + recommendation.buy} Buy vs ${recommendation.sell + recommendation.strongSell} Sell`); }
      if (sellRatio > 0.4) { score -= 2; reasons.push(`High sell rating from analysts`); }
    }

    if (epsTTM !== null) {
      if (epsTTM > 0) { score += 1; reasons.push(`Positive EPS TTM: $${epsTTM.toFixed(2)}`); }
      else { score -= 1; reasons.push(`Negative EPS TTM: $${epsTTM.toFixed(2)}`); }
    }

    if (avgSurprise !== null && avgSurprise > 2) { score += 1; reasons.push(`Avg surprise: +${avgSurprise}%`); }
    if (avgSurprise !== null && avgSurprise < -2) { score -= 1; reasons.push(`Avg surprise: ${avgSurprise}%`); }

    let outlook, outlookLevel;
    if (history.length === 0 && !recommendation) {
      outlook = 'Insufficient Data';
      outlookLevel = 'neutral';
    } else if (score >= 3) {
      outlook = 'Likely Positive';
      outlookLevel = 'positive';
    } else if (score >= 1) {
      outlook = 'Leaning Positive';
      outlookLevel = 'positive';
    } else if (score === 0) {
      outlook = 'Neutral';
      outlookLevel = 'neutral';
    } else if (score >= -2) {
      outlook = 'Leaning Negative';
      outlookLevel = 'negative';
    } else {
      outlook = 'Likely Negative';
      outlookLevel = 'negative';
    }

    res.json({
      symbol,
      name: profile.name || symbol,
      sector: profile.finnhubIndustry || null,
      epsHistory: history,
      beatRate,
      avgSurprise,
      recommendation,
      epsTTM,
      peRatio,
      nextEarnings,
      currentEstimate,
      outlook,
      outlookLevel,
      outlookReason: reasons.join('. ') + (reasons.length > 0 ? '.' : '')
    });
  } catch (error) {
    console.error('Error fetching earnings analysis:', error);
    res.status(500).json({ error: 'Failed to fetch earnings analysis' });
  }
});

// Store scheduler and websocket instances
let scheduler = null;
let wsManager = null;

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database tables if needed
    await db.initializeTable();
    await db.initializeUsersTable();
    await db.initializePasswordResetTable();
    await db.initializeEarningsConstraint();
    await db.initializeMetricExplanationsTable();
    await db.initializeOptionTradesTable();
    await db.initializeAiPicksTable();
    await db.initializeUserEarningsSymbolsTable();
    console.log('Database tables initialized');

    // Initialize scheduler
    scheduler = initializeScheduler();
    console.log('Scheduler initialized');

    // Create HTTP server and Socket.IO
    const server = http.createServer(app);
    const io = new SocketIO(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    // Initialize Finnhub WebSocket manager
    wsManager = new FinnhubWebSocketManager(FINNHUB_API_KEY, io);
    wsManager.connect();
    console.log('Finnhub WebSocket manager initialized');

    // Handle frontend Socket.IO connections
    io.on('connection', (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      // Client requests to subscribe to symbols
      socket.on('subscribe', (symbols) => {
        if (Array.isArray(symbols)) {
          symbols.forEach(s => wsManager.subscribe(s));
        } else if (typeof symbols === 'string') {
          wsManager.subscribe(symbols);
        }
      });

      // Client requests to unsubscribe from a symbol
      socket.on('unsubscribe', (symbol) => {
        if (typeof symbol === 'string') {
          wsManager.unsubscribe(symbol);
        }
      });

      // Send current prices snapshot on connect
      socket.on('get-prices', () => {
        socket.emit('prices-snapshot', wsManager.latestPrices);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });

    // WebSocket status endpoint
    app.get('/api/ws/status', (req, res) => {
      res.json(wsManager ? wsManager.getStatus() : { connected: false });
    });

    // Serve Angular static files in production
    const distPath = path.join(__dirname, '..', 'stock-market-app', 'dist', 'stock-market-app', 'browser');
    const fs = require('fs');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('{*path}', (req, res) => {
        // Don't serve Angular for API routes
        if (req.originalUrl.startsWith('/api/')) {
          return res.status(404).json({ error: 'API endpoint not found' });
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
      console.log('Serving Angular static files from:', distPath);
    } else {
      console.log('Angular dist not found at:', distPath, '- skipping static serving');
    }

    server.listen(PORT, () => {
      console.log(`Stock market backend server running on http://localhost:${PORT}`);
      console.log(`Finnhub API Key configured: ${FINNHUB_API_KEY ? 'Yes' : 'No'}`);
      console.log(`Database connected: Yes`);
      console.log(`Scheduler: Daily refresh at 9:00 AM`);
      console.log(`WebSocket: Live price streaming enabled`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
