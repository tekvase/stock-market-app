const cron = require('node-cron');
const { db } = require('./database');
const axios = require('axios');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';

// Helper function to make Finnhub API requests
async function finnhubRequest(endpoint, params = {}) {
  try {
    const response = await axios.get(`${FINNHUB_BASE_URL}${endpoint}`, {
      params: {
        ...params,
        token: FINNHUB_API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error('Finnhub API Error:', error.message);
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

// Refresh all stocks in the database
async function refreshAllStocks() {
  try {
    console.log('🔄 Starting scheduled stock data refresh...');
    const startTime = Date.now();

    // Get all stocks from database
    const stocks = await db.getWatchlist();

    if (stocks.length === 0) {
      console.log('📭 No stocks in database to refresh');
      return;
    }

    console.log(`📊 Refreshing data for ${stocks.length} stocks...`);

    let successCount = 0;
    let errorCount = 0;

    // Refresh each stock with a small delay to avoid rate limiting
    for (const stock of stocks) {
      try {
        console.log(`  Fetching data for ${stock.symbol}...`);

        const [quote, profile] = await Promise.all([
          getStockQuote(stock.symbol),
          getCompanyProfile(stock.symbol)
        ]);

        await db.upsertStock({
          symbol: stock.symbol,
          displaySymbol: stock.display_symbol || stock.symbol,
          assetType: stock.asset_type || 'Common Stock',
          sector: profile.finnhubIndustry || stock.sector,
          currency: profile.currency || stock.currency || 'USD',
          companyProfile: profile,
          quote: quote
        });

        successCount++;
        console.log(`  ✅ ${stock.symbol} updated successfully`);

        // Small delay to avoid hitting API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        errorCount++;
        console.error(`  ❌ Error refreshing ${stock.symbol}:`, error.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✨ Stock refresh completed in ${duration}s`);
    console.log(`   Success: ${successCount} | Errors: ${errorCount}`);

  } catch (error) {
    console.error('❌ Error in scheduled stock refresh:', error);
  }
}

// Fetch earnings calendar from Finnhub for a date range
async function fetchEarningsCalendar(fromDate, toDate) {
  try {
    console.log(`📅 Fetching earnings calendar from ${fromDate} to ${toDate}...`);
    const data = await finnhubRequest('/calendar/earnings', { from: fromDate, to: toDate });

    if (!data || !data.earningsCalendar || data.earningsCalendar.length === 0) {
      console.log('📭 No earnings data found for this period');
      return [];
    }

    console.log(`📊 Found ${data.earningsCalendar.length} earnings entries`);

    const earnings = data.earningsCalendar.map(item => ({
      symbol: item.symbol,
      date: item.date,
      epsActual: item.epsActual || null,
      epsEstimate: item.epsEstimate || null,
      time: item.hour || null,  // bmo = before market open, amc = after market close
      revenueActual: item.revenueActual || null,
      revenueEstimate: item.revenueEstimate || null,
      year: item.year || new Date(item.date).getFullYear()
    }));

    return earnings;
  } catch (error) {
    console.error('❌ Error fetching earnings calendar:', error.message);
    return [];
  }
}

// Refresh earnings data - fetches next 3 months of earnings (month by month to avoid API limits)
async function refreshEarnings() {
  try {
    console.log('🔄 Starting monthly earnings data refresh...');
    const startTime = Date.now();

    // Initialize constraint for upserts
    await db.initializeEarningsConstraint();

    const today = new Date();
    let totalInserted = 0;
    let totalFetched = 0;

    // Fetch each month separately to avoid Finnhub's 1500 entry limit per request
    for (let i = 0; i < 3; i++) {
      const monthStart = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + i + 1, 0);

      // For the current month, start from today instead of the 1st
      const fromStr = (i === 0 ? today : monthStart).toISOString().split('T')[0];
      const toStr = monthEnd.toISOString().split('T')[0];

      console.log(`📅 Fetching month ${i + 1}/3: ${fromStr} to ${toStr}`);
      const earnings = await fetchEarningsCalendar(fromStr, toStr);
      totalFetched += earnings.length;

      if (earnings.length > 0) {
        const inserted = await db.bulkInsertEarnings(earnings);
        totalInserted += inserted;
      }

      // Small delay between month requests
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }

    // PHASE 2: Fetch earnings individually for all watchlist stocks
    // (Finnhub's general calendar caps at ~1500 entries, missing smaller stocks)
    console.log('📋 Phase 2: Fetching earnings for watchlist stocks individually...');
    try {
      const watchlistSymbols = await db.getAllWatchlistSymbols();
      console.log(`  Found ${watchlistSymbols.length} unique watchlist symbols across all users`);

      if (watchlistSymbols.length > 0) {
        const overallFrom = today.toISOString().split('T')[0];
        const overallTo = new Date(today.getFullYear(), today.getMonth() + 3, 0).toISOString().split('T')[0];
        const existingSymbols = await db.getExistingEarningsSymbols(overallFrom, overallTo);

        const missingSymbols = watchlistSymbols.filter(s => !existingSymbols.has(s));
        console.log(`  ${existingSymbols.size} already have earnings data, ${missingSymbols.length} need individual lookup`);

        let watchlistInserted = 0;
        for (const symbol of missingSymbols) {
          try {
            const data = await finnhubRequest('/calendar/earnings', {
              symbol,
              from: overallFrom,
              to: overallTo
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
              const inserted = await db.bulkInsertEarnings(earnings);
              watchlistInserted += inserted;
              console.log(`  ✅ ${symbol}: found ${earnings.length} earnings entries`);
            } else {
              console.log(`  ⏭️  ${symbol}: no upcoming earnings`);
            }

            // Respect rate limits - small delay between requests
            await new Promise(resolve => setTimeout(resolve, 1100));
          } catch (err) {
            console.error(`  ❌ ${symbol}: ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, 1100));
          }
        }
        totalInserted += watchlistInserted;
        console.log(`  Phase 2 complete: ${watchlistInserted} watchlist earnings entries added`);
      }
    } catch (err) {
      console.error('Phase 2 error:', err.message);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✨ Earnings refresh completed in ${duration}s - ${totalInserted}/${totalFetched} entries saved`);
  } catch (error) {
    console.error('❌ Error in earnings refresh:', error);
  }
}

// ========================
// AI DAILY PICKS ENGINE
// ========================

// Dedicated batch rate limiter (separate from server.js live requests)
const batchTimestamps = [];
const BATCH_MAX_PER_MINUTE = 55;

async function waitForBatchSlot() {
  const now = Date.now();
  // Remove timestamps older than 60 seconds
  while (batchTimestamps.length > 0 && batchTimestamps[0] < now - 60000) {
    batchTimestamps.shift();
  }
  if (batchTimestamps.length >= BATCH_MAX_PER_MINUTE) {
    const waitTime = batchTimestamps[0] + 60000 - now + 100;
    await new Promise(r => setTimeout(r, waitTime));
    return waitForBatchSlot();
  }
  batchTimestamps.push(Date.now());
}

async function batchFinnhubRequest(endpoint, params = {}) {
  await waitForBatchSlot();
  try {
    const response = await axios.get(`${FINNHUB_BASE_URL}${endpoint}`, {
      params: { ...params, token: FINNHUB_API_KEY },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.warn('Batch rate limit hit, waiting 15s...');
      await new Promise(r => setTimeout(r, 15000));
      return batchFinnhubRequest(endpoint, params);
    }
    return null;
  }
}

// Sentiment word lists (matches server.js)
const POSITIVE_WORDS = [
  'surge', 'surges', 'surging', 'rally', 'rallies', 'rallying',
  'gain', 'gains', 'rise', 'rises', 'rising', 'jump', 'jumps',
  'soar', 'soars', 'soaring', 'climb', 'climbs', 'climbing',
  'boost', 'boosts', 'record high', 'all-time high', 'bullish',
  'upgrade', 'upgrades', 'outperform', 'beat', 'beats', 'beating',
  'strong', 'growth', 'profit', 'profits', 'profitable',
  'optimistic', 'optimism', 'recover', 'recovery', 'rebound',
  'positive', 'upbeat', 'breakthrough', 'success', 'successful',
  'buy', 'overweight', 'opportunity', 'opportunities'
];

const NEGATIVE_WORDS = [
  'drop', 'drops', 'dropping', 'fall', 'falls', 'falling',
  'decline', 'declines', 'declining', 'plunge', 'plunges', 'plunging',
  'crash', 'crashes', 'crashing', 'tumble', 'tumbles', 'tumbling',
  'sell-off', 'selloff', 'bearish', 'downgrade', 'downgrades',
  'loss', 'losses', 'losing', 'lose', 'weak', 'weakness',
  'miss', 'misses', 'missed', 'underperform', 'cut', 'cuts',
  'fear', 'fears', 'concern', 'concerns', 'worried', 'worry',
  'risk', 'risks', 'crisis', 'recession', 'layoff', 'layoffs',
  'warning', 'warns', 'threat', 'threats', 'negative',
  'slump', 'slumps', 'tank', 'tanks', 'sell', 'underweight',
  'tariff', 'tariffs', 'inflation', 'debt', 'default', 'bankrupt'
];

function analyzeBatchSentiment(newsArticles) {
  if (!newsArticles || newsArticles.length === 0) {
    return { score: 0, positiveCount: 0, negativeCount: 0, totalCount: 0 };
  }

  let totalPositive = 0;
  let totalNegative = 0;

  for (const article of newsArticles) {
    const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
    let articlePos = 0;
    let articleNeg = 0;
    for (const word of POSITIVE_WORDS) { if (text.includes(word)) articlePos++; }
    for (const word of NEGATIVE_WORDS) { if (text.includes(word)) articleNeg++; }
    if (articlePos > articleNeg) totalPositive++;
    else if (articleNeg > articlePos) totalNegative++;
  }

  const total = newsArticles.length;
  const score = total > 0 ? (totalPositive - totalNegative) / total : 0;
  return {
    score: Math.max(-1, Math.min(1, score)),
    positiveCount: totalPositive,
    negativeCount: totalNegative,
    totalCount: total
  };
}

function calculateAiScore(buyRatio, changePercent, sentimentScore, epsGrowth, revenueGrowth, week13Return) {
  // 30% Analyst Consensus
  const analystComponent = buyRatio; // 0-100

  // 20% Growth (EPS + Revenue averaged)
  const avgGrowth = ((epsGrowth || 0) + (revenueGrowth || 0)) / 2;
  const clampedGrowth = Math.max(-50, Math.min(100, avgGrowth));
  const growthComponent = ((clampedGrowth + 50) / 150) * 100;

  // 20% Trend (13-week return as proxy for above 50 MA)
  const clampedTrend = Math.max(-30, Math.min(30, week13Return || 0));
  const trendComponent = ((clampedTrend + 30) / 60) * 100;

  // 15% Momentum (daily change)
  const clampedChange = Math.max(-5, Math.min(5, changePercent || 0));
  const momentumComponent = ((clampedChange + 5) / 10) * 100;

  // 15% News Sentiment
  const sentimentComponent = ((sentimentScore + 1) / 2) * 100;

  const composite = Math.round(
    (analystComponent * 0.30) + (growthComponent * 0.20) + (trendComponent * 0.20) +
    (momentumComponent * 0.15) + (sentimentComponent * 0.15)
  );
  return Math.max(0, Math.min(100, composite));
}

function getSentimentLabel(score) {
  if (score > 0.15) return 'Bullish';
  if (score < -0.15) return 'Bearish';
  return 'Neutral';
}

function getConsensus(buyRatio) {
  if (buyRatio > 70) return 'Strong Buy';
  if (buyRatio > 50) return 'Buy';
  if (buyRatio <= 15) return 'Strong Sell';
  if (buyRatio <= 30) return 'Sell';
  return 'Hold';
}

function assignCategory(pick) {
  if (pick.price < 50 && pick.ai_score > 60) return 'Low-Cost Opportunities';
  if (pick.price >= 50 && pick.price <= 300 && pick.change_percent > 0) return 'Mid-Cap Momentum';
  if (pick.price > 300 && pick.buy_ratio >= 60) return 'High-Value Premium';
  if (pick.change_percent > 2 && pick.buy_ratio >= 50) return 'Breakout Candidates';
  return null;
}

function generateReasonText(pick) {
  const reasons = [];
  if (pick.buy_ratio >= 80) {
    reasons.push(`${pick.buy_ratio}% analyst buy consensus from ${pick.total_analysts} analysts`);
  } else if (pick.buy_ratio >= 60) {
    reasons.push(`Strong ${pick.buy_ratio}% analyst buy rating`);
  } else if (pick.buy_ratio >= 40) {
    reasons.push(`${pick.buy_ratio}% analyst buy rating`);
  }

  if (pick.eps_growth > 20) {
    reasons.push(`Strong EPS growth of ${pick.eps_growth.toFixed(1)}% YoY`);
  } else if (pick.eps_growth > 0) {
    reasons.push(`Positive EPS growth at ${pick.eps_growth.toFixed(1)}% YoY`);
  }

  if (pick.revenue_growth > 15) {
    reasons.push(`Revenue growing ${pick.revenue_growth.toFixed(1)}% YoY`);
  }

  if (pick.above_50_ma && pick.week_13_return > 5) {
    reasons.push(`Uptrend: +${pick.week_13_return.toFixed(1)}% over 13 weeks`);
  } else if (pick.above_50_ma) {
    reasons.push('Trading above 50-day moving average');
  }

  if (pick.change_percent > 2) {
    reasons.push(`Price up ${pick.change_percent.toFixed(1)}% showing strong momentum`);
  }

  if (pick.sentiment_label === 'Bullish' && pick.news_positive_count > 0) {
    reasons.push(`Bullish news sentiment (${pick.news_positive_count} positive headlines)`);
  } else if (pick.sentiment_label === 'Bearish') {
    reasons.push('Caution: recent news sentiment is bearish');
  }

  return reasons.slice(0, 3).join('. ') + '.';
}

// Quick seed with popular stocks (runs on startup for immediate UI data)
const QUICK_SEED_STOCKS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JPM', 'V',
  'UNH', 'MA', 'HD', 'PG', 'JNJ', 'ABBV', 'CRM', 'NFLX', 'AMD', 'COST',
  'PEP', 'ADBE', 'KO', 'MRK', 'LLY', 'AVGO', 'CSCO', 'TMO', 'ACN', 'MCD',
  'INTC', 'NKE', 'DIS', 'QCOM', 'TXN', 'AMGN', 'PYPL', 'ISRG', 'AMAT', 'BKNG',
  'BA', 'GS', 'CAT', 'DE', 'SQ', 'SHOP', 'PLTR', 'RIVN', 'SOFI', 'COIN'
];

async function quickSeedPicks() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const existingCount = await db.getAiPicksCount(today);
    if (existingCount > 0) {
      console.log(`Quick seed: ${existingCount} picks already exist for today. Skipping.`);
      return;
    }

    console.log('⚡ Quick seed: Loading 50 popular stocks for immediate UI...');
    const startTime = Date.now();
    const picks = [];

    for (const symbol of QUICK_SEED_STOCKS) {
      try {
        const [recs, quote, profile, metrics] = await Promise.all([
          batchFinnhubRequest('/stock/recommendation', { symbol }).catch(() => []),
          batchFinnhubRequest('/quote', { symbol }).catch(() => null),
          batchFinnhubRequest('/stock/profile2', { symbol }).catch(() => null),
          batchFinnhubRequest('/stock/metric', { symbol, metric: 'all' }).catch(() => null)
        ]);

        const latest = recs && recs.length > 0 ? recs[0] : null;
        if (!latest || !quote || quote.c <= 0) continue;

        const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0);
        if (total === 0) continue;

        const m = metrics?.metric || {};
        const week13Return = m['13WeekPriceReturnDaily'] ?? null;
        const buyRatio = Math.round(((latest.strongBuy || 0) + (latest.buy || 0)) / total * 100);
        const pick = {
          symbol,
          strong_buy: latest.strongBuy || 0,
          buy: latest.buy || 0,
          hold: latest.hold || 0,
          sell: latest.sell || 0,
          strong_sell: latest.strongSell || 0,
          buy_ratio: buyRatio,
          total_analysts: total,
          consensus: getConsensus(buyRatio),
          name: profile?.name || symbol,
          sector: profile?.finnhubIndustry || '',
          logo: profile?.logo || '',
          price: quote.c || 0,
          change: quote.d || 0,
          change_percent: quote.dp || 0,
          avg_volume: m['10DayAverageTradingVolume'] || 0,
          market_cap: m['marketCapitalization'] || 0,
          eps_growth: m['epsGrowthTTMYoy'] ?? null,
          revenue_growth: m['revenueGrowthTTMYoy'] ?? null,
          pe_ratio: m['peBasicExclExtraTTM'] ?? null,
          week_13_return: week13Return,
          above_50_ma: week13Return !== null ? week13Return > 0 : false,
          sentiment_score: 0,
          sentiment_label: 'Neutral',
          momentum_score: ((Math.max(-5, Math.min(5, quote.dp || 0)) + 5) / 10) * 100,
          news_positive_count: 0,
          news_negative_count: 0,
          news_total_count: 0
        };
        pick.ai_score = calculateAiScore(pick.buy_ratio, pick.change_percent, 0, pick.eps_growth, pick.revenue_growth, pick.week_13_return);
        pick.category = assignCategory(pick);
        pick.reason_text = generateReasonText(pick);
        pick.pick_date = today;
        picks.push(pick);
      } catch (err) {
        // skip
      }
    }

    if (picks.length > 0) {
      picks.sort((a, b) => b.ai_score - a.ai_score);
      const inserted = await db.bulkUpsertAiPicks(picks);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⚡ Quick seed complete: ${inserted} picks saved in ${duration}s`);
    }
  } catch (error) {
    console.error('Quick seed error:', error.message);
  }
}

// Main 4-phase AI Daily Picks batch job
async function refreshAiDailyPicks() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Check if we already have picks for today
    const existingCount = await db.getAiPicksCount(today);
    if (existingCount > 50) {
      console.log(`AI picks already exist for ${today} (${existingCount} picks). Skipping batch.`);
      return;
    }

    console.log('🤖 Starting AI Daily Picks batch processing...');
    const startTime = Date.now();

    // PHASE 1: Fetch all US symbols
    console.log('📡 Phase 1: Fetching all US stock symbols...');
    const allSymbols = await batchFinnhubRequest('/stock/symbol', { exchange: 'US' });
    if (!allSymbols || allSymbols.length === 0) {
      console.error('Failed to fetch US symbols');
      return;
    }

    // Filter to common stocks tradeable on major US exchanges only
    const US_EXCHANGE_MICS = ['XNYS', 'XNAS', 'XASE', 'ARCX', 'BATS'];
    const commonStocks = allSymbols.filter(s =>
      s.type === 'Common Stock' &&
      !s.symbol.includes('.') &&
      US_EXCHANGE_MICS.includes(s.mic)
    ).map(s => s.symbol);
    console.log(`  Found ${allSymbols.length} total symbols, ${commonStocks.length} US-tradeable common stocks`);

    // PHASE 2: Fetch recommendations for all common stocks
    console.log('📊 Phase 2: Fetching analyst recommendations...');
    const stocksWithRecs = [];
    let phase2Count = 0;

    for (const symbol of commonStocks) {
      try {
        const recs = await batchFinnhubRequest('/stock/recommendation', { symbol });
        phase2Count++;

        if (phase2Count % 500 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
          console.log(`  Phase 2 progress: ${phase2Count}/${commonStocks.length} (${elapsed}min)`);
        }

        if (recs && recs.length > 0) {
          const latest = recs[0];
          const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0);
          if (total > 0) {
            const buyRatio = Math.round(((latest.strongBuy || 0) + (latest.buy || 0)) / total * 100);
            stocksWithRecs.push({
              symbol,
              strong_buy: latest.strongBuy || 0,
              buy: latest.buy || 0,
              hold: latest.hold || 0,
              sell: latest.sell || 0,
              strong_sell: latest.strongSell || 0,
              buy_ratio: buyRatio,
              total_analysts: total,
              consensus: getConsensus(buyRatio)
            });
          }
        }
      } catch (err) {
        // silently skip
      }
    }
    console.log(`  Phase 2 complete: ${stocksWithRecs.length} stocks have analyst data`);

    // PHASE 3: Fetch quotes, profiles, and fundamentals
    console.log('💰 Phase 3: Fetching prices, profiles, and fundamentals...');
    const enrichedPicks = [];
    let phase3Count = 0;

    for (const stock of stocksWithRecs) {
      try {
        const [quote, profile, metrics] = await Promise.all([
          batchFinnhubRequest('/quote', { symbol: stock.symbol }),
          batchFinnhubRequest('/stock/profile2', { symbol: stock.symbol }),
          batchFinnhubRequest('/stock/metric', { symbol: stock.symbol, metric: 'all' })
        ]);

        phase3Count++;
        if (phase3Count % 200 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
          console.log(`  Phase 3 progress: ${phase3Count}/${stocksWithRecs.length} (${elapsed}min)`);
        }

        if (quote && quote.c > 0) {
          const m = metrics?.metric || {};
          const week13Return = m['13WeekPriceReturnDaily'] ?? null;
          enrichedPicks.push({
            ...stock,
            name: profile?.name || stock.symbol,
            sector: profile?.finnhubIndustry || '',
            logo: profile?.logo || '',
            price: quote.c || 0,
            change: quote.d || 0,
            change_percent: quote.dp || 0,
            avg_volume: m['10DayAverageTradingVolume'] || 0, // in millions
            market_cap: m['marketCapitalization'] || 0, // in millions
            eps_growth: m['epsGrowthTTMYoy'] ?? null,
            revenue_growth: m['revenueGrowthTTMYoy'] ?? null,
            pe_ratio: m['peBasicExclExtraTTM'] ?? null,
            week_13_return: week13Return,
            above_50_ma: week13Return !== null ? week13Return > 0 : false,
            // Defaults for sentiment (updated in phase 5)
            sentiment_score: 0,
            sentiment_label: 'Neutral',
            news_positive_count: 0,
            news_negative_count: 0,
            news_total_count: 0
          });
        }
      } catch (err) {
        // silently skip
      }
    }
    console.log(`  Phase 3 complete: ${enrichedPicks.length} stocks enriched`);

    // PHASE 4: Apply progressive filters
    console.log('🔍 Phase 4: Applying filters...');
    let filtered = enrichedPicks;
    console.log(`  Starting with ${filtered.length} stocks`);

    // Liquidity filter: avg daily volume > 100K shares (0.1M) or market cap > $300M
    filtered = filtered.filter(s => s.avg_volume > 0.1 || s.market_cap > 300);
    console.log(`  After liquidity filter: ${filtered.length} stocks`);

    // Growth filter: positive EPS growth OR positive revenue growth
    filtered = filtered.filter(s =>
      (s.eps_growth !== null && s.eps_growth > 0) ||
      (s.revenue_growth !== null && s.revenue_growth > 0)
    );
    console.log(`  After growth filter: ${filtered.length} stocks`);

    // Trend filter: above 50-day MA (13-week return > 0)
    filtered = filtered.filter(s => s.above_50_ma === true);
    console.log(`  After trend filter: ${filtered.length} stocks`);

    // Calculate preliminary AI scores
    for (const pick of filtered) {
      pick.momentum_score = ((Math.max(-5, Math.min(5, pick.change_percent || 0)) + 5) / 10) * 100;
      pick.ai_score = calculateAiScore(pick.buy_ratio, pick.change_percent, 0, pick.eps_growth, pick.revenue_growth, pick.week_13_return);
    }

    // Sort by preliminary score to pick top 200 for news analysis
    filtered.sort((a, b) => b.ai_score - a.ai_score);

    // PHASE 5: Fetch news for top 200 filtered stocks
    const newsTargets = filtered.slice(0, 200);
    console.log(`📰 Phase 5: Fetching news sentiment for top ${newsTargets.length} stocks...`);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let phase5Count = 0;

    for (const pick of newsTargets) {
      try {
        const news = await batchFinnhubRequest('/company-news', {
          symbol: pick.symbol,
          from: threeDaysAgo,
          to: today
        });

        phase5Count++;
        if (phase5Count % 50 === 0) {
          console.log(`  Phase 5 progress: ${phase5Count}/${newsTargets.length}`);
        }

        if (news && news.length > 0) {
          const sentiment = analyzeBatchSentiment(news.slice(0, 20));
          pick.sentiment_score = sentiment.score;
          pick.sentiment_label = getSentimentLabel(sentiment.score);
          pick.news_positive_count = sentiment.positiveCount;
          pick.news_negative_count = sentiment.negativeCount;
          pick.news_total_count = sentiment.totalCount;
        }
      } catch (err) {
        // silently skip
      }
    }
    console.log('  Phase 5 complete: news sentiment analyzed');

    // Sentiment filter: exclude strongly bearish stocks
    filtered = filtered.filter(s => s.sentiment_score >= -0.3);
    console.log(`  After sentiment filter: ${filtered.length} stocks`);

    // Recalculate final AI scores with all factors
    for (const pick of filtered) {
      pick.ai_score = calculateAiScore(pick.buy_ratio, pick.change_percent, pick.sentiment_score, pick.eps_growth, pick.revenue_growth, pick.week_13_return);
      pick.category = assignCategory(pick);
      pick.reason_text = generateReasonText(pick);
      pick.pick_date = today;
    }

    // Sort by final AI score
    filtered.sort((a, b) => b.ai_score - a.ai_score);

    // Save to database
    console.log(`💾 Saving ${filtered.length} AI picks to database...`);
    const inserted = await db.bulkUpsertAiPicks(filtered);
    console.log(`  Saved ${inserted} picks`);

    // Cleanup old picks
    const cleaned = await db.cleanupOldAiPicks(7);
    if (cleaned > 0) console.log(`  Cleaned up ${cleaned} old picks`);

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`🤖 AI Daily Picks batch completed in ${duration} minutes — ${filtered.length} stocks passed all filters`);
  } catch (error) {
    console.error('❌ Error in AI Daily Picks batch:', error);
  }
}

// Initialize scheduler
function initializeScheduler() {
  console.log('⏰ Initializing stock data scheduler...');

  // Schedule daily refresh at 9:00 AM
  const dailyJob = cron.schedule('0 9 * * *', async () => {
    console.log('\n🌅 Daily 9 AM scheduled refresh triggered');
    await refreshAllStocks();
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });

  console.log('✅ Daily refresh scheduled for 9:00 AM (America/New_York timezone)');

  // Schedule monthly earnings refresh - 1st of every month at 6:00 AM
  const monthlyEarningsJob = cron.schedule('0 6 1 * *', async () => {
    console.log('\n📅 Monthly earnings refresh triggered');
    await refreshEarnings();
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });

  console.log('✅ Monthly earnings refresh scheduled for 1st of each month at 6:00 AM');

  // Schedule AI Daily Picks batch at 1:00 AM ET
  const aiPicksJob = cron.schedule('0 1 * * *', async () => {
    console.log('\n🤖 AI Daily Picks batch triggered');
    await refreshAiDailyPicks();
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });

  console.log('✅ AI Daily Picks batch scheduled for 1:00 AM');

  // Quick seed on startup (50 popular stocks for immediate UI), then full batch runs at 1 AM
  quickSeedPicks();

  // Optional: Schedule more frequent updates during market hours
  const marketHoursJob = cron.schedule('*/15 9-16 * * 1-5', async () => {
    console.log('\n📈 Market hours refresh triggered');
    await refreshAllStocks();
  }, {
    scheduled: false,
    timezone: "America/New_York"
  });

  return {
    dailyJob,
    marketHoursJob,
    monthlyEarningsJob,
    aiPicksJob,
    refreshAllStocks,
    refreshEarnings,
    refreshAiDailyPicks,

    startMarketHoursUpdates: () => {
      marketHoursJob.start();
      console.log('✅ Market hours updates enabled (every 15 minutes during trading hours)');
    },

    stopMarketHoursUpdates: () => {
      marketHoursJob.stop();
      console.log('⏸️  Market hours updates disabled');
    },

    getStatus: () => {
      return {
        dailyJobRunning: dailyJob.getStatus() === 'scheduled',
        marketHoursJobRunning: marketHoursJob.getStatus() === 'scheduled'
      };
    }
  };
}

module.exports = { initializeScheduler, refreshAllStocks, refreshEarnings, refreshAiDailyPicks };
