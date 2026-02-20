const WebSocket = require('ws');

class FinnhubWebSocketManager {
  constructor(apiKey, io) {
    this.apiKey = apiKey;
    this.io = io; // Socket.IO server instance
    this.ws = null;
    this.subscribedSymbols = new Set();
    this.latestPrices = {}; // { symbol: { price, timestamp, volume } }
    this.onPriceCallback = null; // external callback for price alerts
    this.reconnectInterval = 5000;
    this.reconnectTimer = null;
    this.isConnected = false;
  }

  connect() {
    if (this.ws) {
      this.ws.close();
    }

    console.log('[WS] Connecting to Finnhub WebSocket...');
    this.ws = new WebSocket(`wss://ws.finnhub.io?token=${this.apiKey}`);

    this.ws.on('open', () => {
      this.isConnected = true;
      console.log('[WS] Connected to Finnhub WebSocket');

      // Re-subscribe to all symbols after reconnect
      for (const symbol of this.subscribedSymbols) {
        this._sendSubscribe(symbol);
      }
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        if (message.type === 'trade' && message.data) {
          for (const trade of message.data) {
            const symbol = trade.s;
            const price = trade.p;
            const timestamp = trade.t;
            const volume = trade.v;

            this.latestPrices[symbol] = { price, timestamp, volume };

            // Push to all connected frontend clients
            this.io.emit('price-update', {
              symbol,
              price,
              timestamp,
              volume
            });

            // Fire price alert callback if registered
            if (this.onPriceCallback) {
              this.onPriceCallback(symbol, price, timestamp);
            }
          }
        }
      } catch (err) {
        // Ignore parse errors for ping/pong frames
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      console.log('[WS] Finnhub WebSocket disconnected. Reconnecting...');
      this._scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('[WS] Finnhub WebSocket error:', error.message);
    });
  }

  _sendSubscribe(symbol) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', symbol }));
      console.log(`[WS] Subscribed to ${symbol}`);
    }
  }

  _sendUnsubscribe(symbol) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
      console.log(`[WS] Unsubscribed from ${symbol}`);
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  subscribe(symbol) {
    const upper = symbol.toUpperCase();
    if (this.subscribedSymbols.has(upper)) return;

    this.subscribedSymbols.add(upper);
    this._sendSubscribe(upper);
    console.log(`[WS] Symbol ${upper} added. Active subscriptions: ${this.subscribedSymbols.size}`);
  }

  unsubscribe(symbol) {
    const upper = symbol.toUpperCase();
    if (!this.subscribedSymbols.has(upper)) return;

    this.subscribedSymbols.delete(upper);
    this._sendUnsubscribe(upper);
    delete this.latestPrices[upper];
    console.log(`[WS] Symbol ${upper} removed. Active subscriptions: ${this.subscribedSymbols.size}`);
  }

  getLatestPrice(symbol) {
    return this.latestPrices[symbol.toUpperCase()] || null;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      subscriptionCount: this.subscribedSymbols.size
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Unsubscribe from all before closing
      for (const symbol of this.subscribedSymbols) {
        this._sendUnsubscribe(symbol);
      }
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    console.log('[WS] Finnhub WebSocket manager disconnected');
  }
}

module.exports = { FinnhubWebSocketManager };
