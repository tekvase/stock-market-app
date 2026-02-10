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

  async userStockTradeExists(userId, symbol) {
    const query = "SELECT 1 FROM user_stocktrades WHERE user_id = $1 AND symbol = $2 AND status = 'active'";
    const result = await pool.query(query, [userId, symbol.toUpperCase()]);
    return result.rows.length > 0;
  },

  // Earnings operations
  async upsertEarning(earningData) {
    const query = `
      INSERT INTO "Earnings" ("Symbol", "Date", "EpsActual", "EpsEstimate", "Time", "RevenueActual", "RevenueEstimate", "Year", "UpdatedDate")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT ON CONSTRAINT earnings_symbol_date_unique
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
    let inserted = 0;
    for (const earning of earnings) {
      try {
        await this.upsertEarning(earning);
        inserted++;
      } catch (err) {
        // If unique constraint doesn't exist yet, do simple insert
        if (err.code === '42704' || err.message.includes('earnings_symbol_date_unique')) {
          try {
            const query = `
              INSERT INTO "Earnings" ("Symbol", "Date", "EpsActual", "EpsEstimate", "Time", "RevenueActual", "RevenueEstimate", "Year", "UpdatedDate")
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            `;
            await pool.query(query, [
              earning.symbol, earning.date, earning.epsActual, earning.epsEstimate,
              earning.time, earning.revenueActual, earning.revenueEstimate, earning.year
            ]);
            inserted++;
          } catch (innerErr) {
            console.error(`Error inserting earning for ${earning.symbol}:`, innerErr.message);
          }
        } else {
          console.error(`Error upserting earning for ${earning.symbol}:`, err.message);
        }
      }
    }
    return inserted;
  },

  async getWeeklyEarnings(fromDate, toDate) {
    const query = `
      SELECT * FROM "Earnings"
      WHERE "Date" >= $1 AND "Date" <= $2
      ORDER BY "Date" ASC, "Symbol" ASC
    `;
    const result = await pool.query(query, [fromDate, toDate]);
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
  }
};

module.exports = { db, pool };
