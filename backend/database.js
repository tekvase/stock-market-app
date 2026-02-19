const { Pool } = require('pg');

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to Supabase PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Database operations
const db = {
  // Get all stocks from watchlist
  async getWatchlist() {
    const query = `
      SELECT *
      FROM stocks
      ORDER BY symbol ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  // Get single stock by symbol
  async getStockBySymbol(symbol) {
    const query = `
      SELECT *
      FROM stocks
      WHERE symbol = $1
    `;
    const result = await pool.query(query, [symbol.toUpperCase()]);
    return result.rows[0];
  },

  // Add or update stock in watchlist
  async upsertStock(stockData) {
    const {
      symbol,
      displaySymbol,
      assetType,
      sector,
      currency,
      companyProfile,
      quote
    } = stockData;

    const query = `
      INSERT INTO stocks (
        symbol, display_symbol, asset_type, sector, currency,
        company_profile, quote
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (symbol)
      DO UPDATE SET
        display_symbol = EXCLUDED.display_symbol,
        asset_type = EXCLUDED.asset_type,
        sector = EXCLUDED.sector,
        currency = EXCLUDED.currency,
        company_profile = EXCLUDED.company_profile,
        quote = EXCLUDED.quote
      RETURNING *
    `;

    const values = [
      symbol.toUpperCase(),
      displaySymbol || symbol,
      assetType || 'Common Stock',
      sector || null,
      currency || 'USD',
      JSON.stringify(companyProfile || {}),
      JSON.stringify(quote || {})
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Remove stock from watchlist
  async removeStock(symbol) {
    const query = 'DELETE FROM stocks WHERE symbol = $1 RETURNING *';
    const result = await pool.query(query, [symbol.toUpperCase()]);
    return result.rows[0];
  },

  // Update stock quote data
  async updateStockQuote(symbol, quoteData) {
    const query = `
      UPDATE stocks
      SET quote = $1, updated_at = NOW()
      WHERE symbol = $2
      RETURNING *
    `;
    const result = await pool.query(query, [JSON.stringify(quoteData), symbol.toUpperCase()]);
    return result.rows[0];
  },

  // Check if stock exists in watchlist
  async stockExists(symbol) {
    const query = 'SELECT 1 FROM stocks WHERE symbol = $1';
    const result = await pool.query(query, [symbol.toUpperCase()]);
    return result.rows.length > 0;
  },

  // Initialize table (if needed)
  async initializeTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS stocks (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        display_symbol VARCHAR(50),
        asset_type VARCHAR(50),
        sector VARCHAR(100),
        currency VARCHAR(10),
        company_profile JSONB,
        quote JSONB,
        earnings JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(query);
    console.log('Stocks table initialized');
  },

  // User operations
  async createUser(email, hashedPassword, accessCode = 10, firstName = null, lastName = null) {
    const subscriptionEnd = new Date();
    subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1); // Add 1 month

    const query = `
      INSERT INTO users (email, password, "IsActive", "CreatedDate", "SubscriptionEnd", "AccessCode", "FirstName", "LastName")
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
      RETURNING id, email, "IsActive", "CreatedDate", "SubscriptionEnd", "AccessCode", "FirstName", "LastName"
    `;
    const result = await pool.query(query, [email, hashedPassword, true, subscriptionEnd, accessCode, firstName, lastName]);
    return result.rows[0];
  },

  async findUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  },

  async initializeUsersTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        "IsActive" BOOLEAN NOT NULL DEFAULT true,
        "CreatedDate" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "SubscriptionEnd" TIMESTAMP DEFAULT NOW(),
        "AccessCode" INTEGER DEFAULT 10
      )
    `;
    await pool.query(query);

    // Create indexes
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS ix_users_id ON users(id)');

    console.log('Users table initialized');
  },

  // User stock trades operations
  async addUserStockTrade(userId, symbol, currentPrice) {
    const buyPrice = currentPrice;
    const targetPrice1 = +(buyPrice * 1.20).toFixed(2);  // 20% increase
    const targetPrice2 = +(targetPrice1 * 1.05).toFixed(2); // 5% increment from target 1
    const targetPrice3 = +(targetPrice2 * 1.05).toFixed(2); // 5% increment from target 2
    const stopLossPrice = +(currentPrice * 0.98).toFixed(2); // -2% from current price

    const query = `
      INSERT INTO user_stocktrades (user_id, symbol, buy_price, target_price_1, target_price_2, target_price_3, stop_loss_price, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId, symbol.toUpperCase(), buyPrice, targetPrice1, targetPrice2, targetPrice3, stopLossPrice, 'active'
    ]);
    return result.rows[0];
  },

  async updateUserStockTrade(userId, symbol, buyPrice) {
    const targetPrice1 = +(buyPrice * 1.20).toFixed(2);
    const targetPrice2 = +(targetPrice1 * 1.05).toFixed(2);
    const targetPrice3 = +(targetPrice2 * 1.05).toFixed(2);
    const stopLossPrice = +(buyPrice * 0.98).toFixed(2);

    const query = `
      UPDATE user_stocktrades
      SET buy_price = $3, target_price_1 = $4, target_price_2 = $5, target_price_3 = $6, stop_loss_price = $7
      WHERE user_id = $1 AND symbol = $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId, symbol.toUpperCase(), buyPrice, targetPrice1, targetPrice2, targetPrice3, stopLossPrice
    ]);
    return result.rows[0];
  },

  async getUserStockTrades(userId) {
    const query = `
      SELECT * FROM user_stocktrades
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  },

  async deleteUserStockTrade(userId, symbol) {
    const query = `
      UPDATE user_stocktrades
      SET status = 'closed', closed_at = NOW()
      WHERE user_id = $1 AND symbol = $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, [userId, symbol.toUpperCase()]);
    return result.rows[0];
  },

  async hardDeleteUserStockTrade(userId, symbol) {
    const query = `
      DELETE FROM user_stocktrades
      WHERE user_id = $1 AND symbol = $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, [userId, symbol.toUpperCase()]);
    return result.rows[0];
  },

  async userStockTradeExists(userId, symbol) {
    const query = "SELECT 1 FROM user_stocktrades WHERE user_id = $1 AND symbol = $2 AND status = 'active'";
    const result = await pool.query(query, [userId, symbol.toUpperCase()]);
    return result.rows.length > 0;
  },

  async getUserStockTrade(userId, symbol) {
    const query = "SELECT * FROM user_stocktrades WHERE user_id = $1 AND symbol = $2 AND status = 'active'";
    const result = await pool.query(query, [userId, symbol.toUpperCase()]);
    return result.rows[0];
  },

  async updateTradeFields(userId, symbol, shares, sellPrice) {
    const setClauses = [];
    const params = [userId, symbol.toUpperCase()];
    let paramIdx = 3;

    if (shares !== undefined) {
      setClauses.push(`shares = $${paramIdx++}`);
      params.push(shares);
    }
    if (sellPrice !== undefined) {
      setClauses.push(`sell_price = $${paramIdx++}`);
      params.push(sellPrice);
    }

    if (setClauses.length === 0) return null;

    const query = `
      UPDATE user_stocktrades
      SET ${setClauses.join(', ')}
      WHERE user_id = $1 AND symbol = $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, params);
    return result.rows[0];
  },

  // Earnings operations
  async upsertEarning(earningData) {
    const query = `
      INSERT INTO "Earnings" ("Symbol", "Date", "EpsActual", "EpsEstimate", "Time", "RevenueActual", "RevenueEstimate", "Year", "UpdatedDate")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT ("Symbol", "Date")
      DO UPDATE SET
        "EpsActual" = EXCLUDED."EpsActual",
        "EpsEstimate" = EXCLUDED."EpsEstimate",
        "Time" = EXCLUDED."Time",
        "RevenueActual" = EXCLUDED."RevenueActual",
        "RevenueEstimate" = EXCLUDED."RevenueEstimate",
        "Year" = EXCLUDED."Year",
        "UpdatedDate" = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [
      earningData.symbol,
      earningData.date,
      earningData.epsActual,
      earningData.epsEstimate,
      earningData.time,
      earningData.revenueActual,
      earningData.revenueEstimate,
      earningData.year
    ]);
    return result.rows[0];
  },

  async bulkInsertEarnings(earnings) {
    // Deduplicate by symbol+date
    const seen = new Set();
    const unique = earnings.filter(e => {
      const key = e.symbol + '|' + e.date;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let inserted = 0;
    const batchSize = 100;
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      const values = [];
      const params = [];
      let paramIdx = 1;
      for (const item of batch) {
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, NOW())`);
        params.push(item.symbol, item.date, item.epsActual, item.epsEstimate, item.time, item.revenueActual, item.revenueEstimate, item.year);
      }
      try {
        const query = `INSERT INTO "Earnings" ("Symbol", "Date", "EpsActual", "EpsEstimate", "Time", "RevenueActual", "RevenueEstimate", "Year", "UpdatedDate") VALUES ${values.join(', ')} ON CONFLICT ("Symbol", "Date") DO UPDATE SET "EpsEstimate" = EXCLUDED."EpsEstimate", "RevenueEstimate" = EXCLUDED."RevenueEstimate", "EpsActual" = EXCLUDED."EpsActual", "RevenueActual" = EXCLUDED."RevenueActual", "Time" = EXCLUDED."Time", "UpdatedDate" = NOW()`;
        await pool.query(query, params);
        inserted += batch.length;
      } catch (err) {
        console.error(`Error in batch insert:`, err.message);
      }
    }
    return inserted;
  },

  async getEarnings(fromDate, toDate) {
    const query = `
      SELECT * FROM "Earnings"
      WHERE "Date" >= $1 AND "Date" <= $2
      ORDER BY "Date" ASC, "Symbol" ASC
    `;
    const result = await pool.query(query, [fromDate, toDate]);
    return result.rows;
  },

  async getEarningsHistory(symbol) {
    const query = `
      SELECT "Date", "EpsActual", "EpsEstimate", "RevenueActual", "RevenueEstimate"
      FROM "Earnings"
      WHERE "Symbol" = $1 AND "EpsActual" IS NOT NULL
      ORDER BY "Date" DESC
      LIMIT 8
    `;
    const result = await pool.query(query, [symbol.toUpperCase()]);
    return result.rows;
  },

  // Password reset operations
  async initializePasswordResetTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await pool.query(query);
    await pool.query('CREATE INDEX IF NOT EXISTS ix_password_resets_token ON password_resets(token)');
    await pool.query('CREATE INDEX IF NOT EXISTS ix_password_resets_email ON password_resets(email)');
    console.log('Password resets table initialized');
  },

  async createPasswordResetToken(email, token, expiresAt) {
    // Invalidate any existing tokens for this email
    await pool.query(
      'UPDATE password_resets SET used = true WHERE email = $1 AND used = false',
      [email]
    );
    const query = `
      INSERT INTO password_resets (email, token, expires_at)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [email, token, expiresAt]);
    return result.rows[0];
  },

  async findValidResetToken(token) {
    const query = `
      SELECT * FROM password_resets
      WHERE token = $1 AND used = false AND expires_at > NOW()
    `;
    const result = await pool.query(query, [token]);
    return result.rows[0];
  },

  async markTokenUsed(token) {
    const query = 'UPDATE password_resets SET used = true WHERE token = $1';
    await pool.query(query, [token]);
  },

  async updateUserPassword(email, hashedPassword) {
    const query = 'UPDATE users SET password = $1 WHERE email = $2 RETURNING id, email';
    const result = await pool.query(query, [hashedPassword, email]);
    return result.rows[0];
  },

  async initializeEarningsConstraint() {
    try {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS earnings_symbol_date_unique
        ON "Earnings" ("Symbol", "Date")
      `);
      console.log('Earnings constraint initialized');
    } catch (err) {
      console.log('Earnings constraint may already exist:', err.message);
    }
  },

  async initializeMetricExplanationsTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS metric_explanations (
        id SERIAL PRIMARY KEY,
        metric VARCHAR(50) NOT NULL,
        min_value NUMERIC,
        max_value NUMERIC,
        label VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        color VARCHAR(20),
        sort_order INTEGER DEFAULT 0
      )
    `);

    // Seed data if table is empty
    const count = await pool.query('SELECT COUNT(*) FROM metric_explanations');
    if (parseInt(count.rows[0].count) === 0) {
      const seeds = [
        // EPS explanations
        ['EPS', null, 0, 'Negative', 'Company is losing money — not profitable', '#c62828', 1],
        ['EPS', 0, 1, 'Low', 'Very low profit or near break-even', '#e65100', 2],
        ['EPS', 1, 5, 'Moderate', 'Modestly profitable — normal for mid-caps', '#2e7d32', 3],
        ['EPS', 5, 15, 'Strong', 'Healthy, well-established business', '#1565c0', 4],
        ['EPS', 15, null, 'Very Strong', 'Exceptional earnings — industry leader', '#4a148c', 5],
        // P/E explanations
        ['PE', null, 0, 'Negative', 'Company has negative earnings — unprofitable', '#c62828', 1],
        ['PE', 0, 15, 'Undervalued', 'May be undervalued or slow-growth company', '#2e7d32', 2],
        ['PE', 15, 25, 'Fair Value', 'Fairly valued for most industries', '#1565c0', 3],
        ['PE', 25, 50, 'Growth', 'Investors expect high future growth', '#e65100', 4],
        ['PE', 50, null, 'Expensive', 'Priced for aggressive growth — higher risk', '#c62828', 5]
      ];

      for (const [metric, min, max, label, desc, color, order] of seeds) {
        await pool.query(
          `INSERT INTO metric_explanations (metric, min_value, max_value, label, description, color, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [metric, min, max, label, desc, color, order]
        );
      }
      console.log('Metric explanations seeded');
    }
    console.log('Metric explanations table initialized');
  },

  async getMetricExplanations() {
    const result = await pool.query('SELECT * FROM metric_explanations ORDER BY metric, sort_order');
    return result.rows;
  },

  // Option trades operations
  async initializeOptionTradesTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS user_optiontrades (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        symbol VARCHAR(10) NOT NULL,
        option_type VARCHAR(4) NOT NULL CHECK (option_type IN ('Call', 'Put')),
        strike NUMERIC(12, 2) NOT NULL,
        expiry DATE NOT NULL,
        premium_paid NUMERIC(12, 4) NOT NULL,
        contracts INTEGER NOT NULL DEFAULT 1,
        status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
        created_at TIMESTAMP DEFAULT NOW(),
        closed_at TIMESTAMP
      )
    `;
    await pool.query(query);
    await pool.query('CREATE INDEX IF NOT EXISTS ix_optiontrades_user ON user_optiontrades(user_id, status)');
    // Add side column if it doesn't exist (for existing tables)
    try {
      await pool.query(`ALTER TABLE user_optiontrades ADD COLUMN IF NOT EXISTS side VARCHAR(4) NOT NULL DEFAULT 'Buy' CHECK (side IN ('Buy', 'Sell'))`);
    } catch (e) {
      // Column may already exist
    }
    console.log('Option trades table initialized');
  },

  async addUserOptionTrade(userId, { symbol, optionType, strike, expiry, premiumPaid, contracts, side }) {
    const query = `
      INSERT INTO user_optiontrades (user_id, symbol, option_type, strike, expiry, premium_paid, contracts, side, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId, symbol.toUpperCase(), optionType, strike, expiry, premiumPaid, contracts || 1, side || 'Buy'
    ]);
    return result.rows[0];
  },

  async getUserOptionTrades(userId) {
    const query = `
      SELECT * FROM user_optiontrades
      WHERE user_id = $1 AND status = 'active'
      ORDER BY expiry ASC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  },

  async deleteUserOptionTrade(userId, tradeId) {
    const query = `
      UPDATE user_optiontrades
      SET status = 'closed', closed_at = NOW()
      WHERE user_id = $1 AND id = $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, [userId, tradeId]);
    return result.rows[0];
  },

  async updateOptionTradeFields(userId, tradeId, fields) {
    const setClauses = [];
    const params = [userId, tradeId];
    let paramIdx = 3;

    if (fields.premiumPaid !== undefined) {
      setClauses.push(`premium_paid = $${paramIdx++}`);
      params.push(fields.premiumPaid);
    }
    if (fields.contracts !== undefined) {
      setClauses.push(`contracts = $${paramIdx++}`);
      params.push(fields.contracts);
    }
    if (fields.strike !== undefined) {
      setClauses.push(`strike = $${paramIdx++}`);
      params.push(fields.strike);
    }

    if (setClauses.length === 0) return null;

    const query = `
      UPDATE user_optiontrades
      SET ${setClauses.join(', ')}
      WHERE user_id = $1 AND id = $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, params);
    return result.rows[0];
  },

  async getMonthlyPL(userId) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Get P&L from closed trades this month (deleted from watchlist)
    const closedQuery = `
      SELECT symbol, buy_price, sell_price, shares
      FROM user_stocktrades
      WHERE user_id = $1
        AND status = 'closed'
        AND sell_price IS NOT NULL
        AND closed_at >= $2
        AND closed_at <= ($3::date + interval '1 day')
    `;
    const closedResult = await pool.query(closedQuery, [userId, firstOfMonth, lastOfMonth]);

    // Get P&L from active trades that have sell_price set
    const activeQuery = `
      SELECT symbol, buy_price, sell_price, shares
      FROM user_stocktrades
      WHERE user_id = $1
        AND status = 'active'
        AND sell_price IS NOT NULL
        AND sell_price > 0
    `;
    const activeResult = await pool.query(activeQuery, [userId]);

    const allTrades = [...closedResult.rows, ...activeResult.rows];
    let totalPL = 0;
    const details = [];

    for (const trade of allTrades) {
      const buyPrice = parseFloat(trade.buy_price) || 0;
      const sellPrice = parseFloat(trade.sell_price) || 0;
      const shares = trade.shares || 1;
      const pl = (sellPrice - buyPrice) * shares;
      totalPL += pl;
      details.push({
        symbol: trade.symbol,
        buyPrice,
        sellPrice,
        shares,
        pl
      });
    }

    return { totalPL, details };
  },

  async getTradeHistory(userId) {
    const result = await pool.query(`
      SELECT symbol, buy_price, sell_price, shares, status, closed_at, created_at
      FROM user_stocktrades
      WHERE user_id = $1
        AND sell_price IS NOT NULL
        AND sell_price > 0
        AND (status = 'closed' OR status = 'active')
      ORDER BY COALESCE(closed_at, created_at) DESC
    `, [userId]);

    return result.rows.map(row => ({
      symbol: row.symbol,
      buyPrice: parseFloat(row.buy_price) || 0,
      sellPrice: parseFloat(row.sell_price) || 0,
      shares: row.shares || 1,
      pl: ((parseFloat(row.sell_price) || 0) - (parseFloat(row.buy_price) || 0)) * (row.shares || 1),
      closedAt: row.closed_at || row.created_at,
      createdAt: row.created_at
    }));
  },

  // AI Daily Picks operations
  async initializeAiPicksTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_daily_picks (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL,
        name VARCHAR(200),
        sector VARCHAR(100),
        logo TEXT,
        price NUMERIC(12, 2),
        change NUMERIC(12, 4),
        change_percent NUMERIC(8, 4),
        strong_buy INTEGER DEFAULT 0,
        buy INTEGER DEFAULT 0,
        hold INTEGER DEFAULT 0,
        sell INTEGER DEFAULT 0,
        strong_sell INTEGER DEFAULT 0,
        buy_ratio INTEGER DEFAULT 0,
        consensus VARCHAR(20),
        total_analysts INTEGER DEFAULT 0,
        ai_score INTEGER DEFAULT 0,
        sentiment_score NUMERIC(6, 3),
        sentiment_label VARCHAR(20),
        momentum_score NUMERIC(6, 3),
        reason_text TEXT,
        category VARCHAR(50),
        news_positive_count INTEGER DEFAULT 0,
        news_negative_count INTEGER DEFAULT 0,
        news_total_count INTEGER DEFAULT 0,
        avg_volume NUMERIC(14, 2) DEFAULT 0,
        market_cap NUMERIC(14, 2) DEFAULT 0,
        eps_growth NUMERIC(10, 4),
        revenue_growth NUMERIC(10, 4),
        pe_ratio NUMERIC(10, 4),
        week_13_return NUMERIC(10, 4),
        above_50_ma BOOLEAN DEFAULT false,
        pick_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Add new columns for existing tables
    const newCols = [
      'avg_volume NUMERIC(14, 2) DEFAULT 0',
      'market_cap NUMERIC(14, 2) DEFAULT 0',
      'eps_growth NUMERIC(10, 4)',
      'revenue_growth NUMERIC(10, 4)',
      'pe_ratio NUMERIC(10, 4)',
      'week_13_return NUMERIC(10, 4)',
      'above_50_ma BOOLEAN DEFAULT false'
    ];
    for (const col of newCols) {
      try { await pool.query(`ALTER TABLE ai_daily_picks ADD COLUMN IF NOT EXISTS ${col}`); } catch(e) {}
    }
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ai_picks_symbol_date ON ai_daily_picks(symbol, pick_date)');
    await pool.query('CREATE INDEX IF NOT EXISTS ai_picks_date_score ON ai_daily_picks(pick_date, ai_score DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS ai_picks_category ON ai_daily_picks(pick_date, category)');
    console.log('AI daily picks table initialized');
  },

  async bulkUpsertAiPicks(picks) {
    const seen = new Set();
    const unique = picks.filter(p => {
      const key = p.symbol + '|' + p.pick_date;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let inserted = 0;
    const batchSize = 50;
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      const values = [];
      const params = [];
      let paramIdx = 1;
      for (const item of batch) {
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, NOW())`);
        params.push(
          item.symbol, item.name, item.sector, item.logo,
          item.price, item.change, item.change_percent,
          item.strong_buy, item.buy, item.hold, item.sell, item.strong_sell,
          item.buy_ratio, item.consensus, item.total_analysts,
          item.ai_score, item.sentiment_score, item.sentiment_label, item.momentum_score,
          item.reason_text, item.category,
          item.news_positive_count, item.news_negative_count, item.news_total_count,
          item.avg_volume || 0, item.market_cap || 0,
          item.eps_growth ?? null, item.revenue_growth ?? null,
          item.pe_ratio ?? null, item.week_13_return ?? null,
          item.above_50_ma || false,
          item.pick_date
        );
      }
      try {
        const query = `INSERT INTO ai_daily_picks (symbol, name, sector, logo, price, change, change_percent, strong_buy, buy, hold, sell, strong_sell, buy_ratio, consensus, total_analysts, ai_score, sentiment_score, sentiment_label, momentum_score, reason_text, category, news_positive_count, news_negative_count, news_total_count, avg_volume, market_cap, eps_growth, revenue_growth, pe_ratio, week_13_return, above_50_ma, pick_date, updated_at) VALUES ${values.join(', ')} ON CONFLICT (symbol, pick_date) DO UPDATE SET name = EXCLUDED.name, sector = EXCLUDED.sector, logo = EXCLUDED.logo, price = EXCLUDED.price, change = EXCLUDED.change, change_percent = EXCLUDED.change_percent, strong_buy = EXCLUDED.strong_buy, buy = EXCLUDED.buy, hold = EXCLUDED.hold, sell = EXCLUDED.sell, strong_sell = EXCLUDED.strong_sell, buy_ratio = EXCLUDED.buy_ratio, consensus = EXCLUDED.consensus, total_analysts = EXCLUDED.total_analysts, ai_score = EXCLUDED.ai_score, sentiment_score = EXCLUDED.sentiment_score, sentiment_label = EXCLUDED.sentiment_label, momentum_score = EXCLUDED.momentum_score, reason_text = EXCLUDED.reason_text, category = EXCLUDED.category, news_positive_count = EXCLUDED.news_positive_count, news_negative_count = EXCLUDED.news_negative_count, news_total_count = EXCLUDED.news_total_count, avg_volume = EXCLUDED.avg_volume, market_cap = EXCLUDED.market_cap, eps_growth = EXCLUDED.eps_growth, revenue_growth = EXCLUDED.revenue_growth, pe_ratio = EXCLUDED.pe_ratio, week_13_return = EXCLUDED.week_13_return, above_50_ma = EXCLUDED.above_50_ma, updated_at = NOW()`;
        await pool.query(query, params);
        inserted += batch.length;
      } catch (err) {
        console.error('Error in AI picks batch insert:', err.message);
      }
    }
    return inserted;
  },

  async getAiDailyPicks({ priceMin, priceMax, category, sortBy, limit, offset }) {
    const today = new Date().toISOString().split('T')[0];
    let query = 'SELECT * FROM ai_daily_picks WHERE pick_date = $1';
    const params = [today];
    let paramIdx = 2;

    if (priceMin !== null && priceMin !== undefined) {
      query += ` AND price >= $${paramIdx++}`;
      params.push(priceMin);
    }
    if (priceMax !== null && priceMax !== undefined) {
      query += ` AND price <= $${paramIdx++}`;
      params.push(priceMax);
    }
    if (category) {
      query += ` AND category = $${paramIdx++}`;
      params.push(category);
    }

    const validSorts = { ai_score: 'ai_score DESC', price: 'price ASC', change_percent: 'change_percent DESC' };
    query += ` ORDER BY ${validSorts[sortBy] || 'ai_score DESC'}`;
    query += ` LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit || 50, offset || 0);

    const result = await pool.query(query, params);
    return result.rows;
  },

  async getAiPicksTotalCount({ priceMin, priceMax, category }) {
    const today = new Date().toISOString().split('T')[0];
    let query = 'SELECT COUNT(*) FROM ai_daily_picks WHERE pick_date = $1';
    const params = [today];
    let paramIdx = 2;

    if (priceMin !== null && priceMin !== undefined) {
      query += ` AND price >= $${paramIdx++}`;
      params.push(priceMin);
    }
    if (priceMax !== null && priceMax !== undefined) {
      query += ` AND price <= $${paramIdx++}`;
      params.push(priceMax);
    }
    if (category) {
      query += ` AND category = $${paramIdx++}`;
      params.push(category);
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].count);
  },

  async getAiPicksCount(date) {
    const result = await pool.query('SELECT COUNT(*) FROM ai_daily_picks WHERE pick_date = $1', [date]);
    return parseInt(result.rows[0].count);
  },

  async cleanupOldAiPicks(daysToKeep = 7) {
    const result = await pool.query(
      'DELETE FROM ai_daily_picks WHERE pick_date < NOW() - $1::interval RETURNING id',
      [daysToKeep + ' days']
    );
    return result.rowCount;
  }
};

module.exports = { db, pool };
