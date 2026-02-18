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

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✨ Earnings refresh completed in ${duration}s - ${totalInserted}/${totalFetched} entries saved`);
  } catch (error) {
    console.error('❌ Error in earnings refresh:', error);
  }
}

// Popular stocks universe for daily picks
const STOCK_UNIVERSE = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JPM', 'V',
  'UNH', 'MA', 'HD', 'PG', 'JNJ', 'ABBV', 'CRM', 'NFLX', 'AMD', 'COST',
  'PEP', 'ADBE', 'KO', 'MRK', 'LLY', 'AVGO', 'CSCO', 'TMO', 'ACN', 'MCD',
  'INTC', 'NKE', 'DIS', 'QCOM', 'TXN', 'AMGN', 'PYPL', 'ISRG', 'AMAT', 'BKNG',
  'BA', 'GS', 'CAT', 'DE', 'SQ', 'SHOP', 'PLTR', 'RIVN', 'SOFI', 'COIN'
];

// In-memory cache for daily picks
let dailyPicksCache = { date: null, picks: [] };

// Refresh daily stock picks
async function refreshDailyPicks() {
  try {
    console.log('🎯 Starting daily stock picks refresh...');
    const startTime = Date.now();
    const picks = [];

    for (const symbol of STOCK_UNIVERSE) {
      try {
        const [recommendations, quote, profile] = await Promise.all([
          finnhubRequest('/stock/recommendation', { symbol }).catch(() => []),
          finnhubRequest('/quote', { symbol }).catch(() => null),
          finnhubRequest('/stock/profile2', { symbol }).catch(() => null)
        ]);

        const latestRec = recommendations.length > 0 ? recommendations[0] : null;
        if (!latestRec || !quote || !profile || !profile.name) {
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }

        const total = (latestRec.strongBuy || 0) + (latestRec.buy || 0) + (latestRec.hold || 0) + (latestRec.sell || 0) + (latestRec.strongSell || 0);
        if (total === 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }

        const buyRatio = ((latestRec.strongBuy || 0) + (latestRec.buy || 0)) / total;
        let consensus = 'Hold';
        if (buyRatio > 0.7) consensus = 'Strong Buy';
        else if (buyRatio > 0.5) consensus = 'Buy';
        else if (buyRatio <= 0.15) consensus = 'Strong Sell';
        else if (buyRatio <= 0.3) consensus = 'Sell';

        picks.push({
          symbol,
          name: profile.name,
          sector: profile.finnhubIndustry || '',
          logo: profile.logo || '',
          price: quote.c || 0,
          change: quote.d || 0,
          changePercent: quote.dp || 0,
          recommendation: {
            strongBuy: latestRec.strongBuy || 0,
            buy: latestRec.buy || 0,
            hold: latestRec.hold || 0,
            sell: latestRec.sell || 0,
            strongSell: latestRec.strongSell || 0
          },
          buyRatio: Math.round(buyRatio * 100),
          consensus,
          totalAnalysts: total
        });

        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`  ❌ Error fetching ${symbol}:`, error.message);
      }
    }

    // Sort by buyRatio descending, take top 20
    picks.sort((a, b) => b.buyRatio - a.buyRatio);
    dailyPicksCache = {
      date: new Date().toISOString().split('T')[0],
      picks: picks.slice(0, 20)
    };

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎯 Daily picks refresh completed in ${duration}s — ${dailyPicksCache.picks.length} picks cached`);
  } catch (error) {
    console.error('❌ Error in daily picks refresh:', error);
  }
}

function getDailyPicks() {
  return dailyPicksCache;
}

// Initialize scheduler
function initializeScheduler() {
  console.log('⏰ Initializing stock data scheduler...');

  // Schedule daily refresh at 9:00 AM
  // Cron format: second minute hour day month weekday
  // '0 9 * * *' = At 09:00 AM every day
  const dailyJob = cron.schedule('0 9 * * *', async () => {
    console.log('\n🌅 Daily 9 AM scheduled refresh triggered');
    await refreshAllStocks();
  }, {
    scheduled: true,
    timezone: "America/New_York" // Change to your timezone
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

  // Schedule daily picks refresh at 5:30 AM ET
  const dailyPicksJob = cron.schedule('30 5 * * *', async () => {
    console.log('\n🎯 Daily picks refresh triggered');
    await refreshDailyPicks();
  }, {
    scheduled: true,
    timezone: "America/New_York"
  });

  console.log('✅ Daily picks refresh scheduled for 5:30 AM');

  // Fetch picks on startup
  refreshDailyPicks();

  // Optional: Schedule more frequent updates during market hours
  // Runs every 15 minutes from 9:30 AM to 4:00 PM on weekdays
  const marketHoursJob = cron.schedule('*/15 9-16 * * 1-5', async () => {
    console.log('\n📈 Market hours refresh triggered');
    await refreshAllStocks();
  }, {
    scheduled: false, // Set to true to enable
    timezone: "America/New_York"
  });

  // Manual refresh endpoint helper
  return {
    dailyJob,
    marketHoursJob,
    monthlyEarningsJob,
    dailyPicksJob,
    refreshAllStocks,
    refreshEarnings,
    refreshDailyPicks,
    getDailyPicks,

    // Start market hours updates
    startMarketHoursUpdates: () => {
      marketHoursJob.start();
      console.log('✅ Market hours updates enabled (every 15 minutes during trading hours)');
    },

    // Stop market hours updates
    stopMarketHoursUpdates: () => {
      marketHoursJob.stop();
      console.log('⏸️  Market hours updates disabled');
    },

    // Get scheduler status
    getStatus: () => {
      return {
        dailyJobRunning: dailyJob.getStatus() === 'scheduled',
        marketHoursJobRunning: marketHoursJob.getStatus() === 'scheduled'
      };
    }
  };
}

module.exports = { initializeScheduler, refreshAllStocks, refreshEarnings, refreshDailyPicks, getDailyPicks };
