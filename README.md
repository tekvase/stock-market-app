# Stock Market Dashboard

A full-stack application that displays real-time stock market data using Angular frontend and Node.js backend with Finnhub API integration.

## Features

- **Real-time stock data** from Finnhub API
- **Stock list dashboard** with search functionality
- **Detailed stock view** with price charts
- **30-day price history** visualization
- **Responsive design** for desktop and mobile

## Tech Stack

### Frontend
- Angular 21
- TypeScript
- CSS3
- Responsive design

### Backend
- Node.js
- Express.js
- Finnhub API
- CORS enabled

## Project Structure

```
.
├── stock-market-app/     # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── stock-list/
│   │   │   │   └── stock-detail/
│   │   │   ├── services/
│   │   │   │   └── stock.service.ts
│   │   │   └── models/
│   │   │       └── stock.model.ts
│   │   └── styles.css
│   └── package.json
│
└── backend/              # Node.js backend
    ├── server.js
    ├── .env
    └── package.json
```

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies (already done):
   ```bash
   npm install
   ```

3. The `.env` file is already configured with:
   ```
   FINNHUB_API_KEY=d639re1r01qnpqg0b8agd639re1r01qnpqg0b8b0
   PORT=3000
   ```

4. Start the backend server:
   ```bash
   npm start
   ```

   The backend will run on `http://localhost:3000`

### Frontend Setup

1. Navigate to the Angular app directory:
   ```bash
   cd stock-market-app
   ```

2. Install dependencies (already done):
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

   The frontend will run on `http://localhost:4200`

## Running the Application

1. **Start the backend** (Terminal 1):
   ```bash
   cd backend
   npm start
   ```

2. **Start the frontend** (Terminal 2):
   ```bash
   cd stock-market-app
   npm start
   ```

3. **Open your browser** and navigate to:
   ```
   http://localhost:4200
   ```

## API Endpoints

### Backend API (Port 3000)

- `GET /api/health` - Health check endpoint
- `GET /api/stocks` - Get list of default stocks with real-time data
- `GET /api/stock/:symbol` - Get detailed data for a specific stock
- `GET /api/stock/:symbol/history?days=30` - Get historical price data
- `GET /api/search?query=AAPL` - Search for stocks

## Default Stock Symbols

The app displays the following stocks by default:
- AAPL (Apple Inc.)
- GOOGL (Alphabet Inc.)
- MSFT (Microsoft Corporation)
- AMZN (Amazon.com Inc.)
- TSLA (Tesla Inc.)
- NVDA (NVIDIA Corporation)
- META (Meta Platforms Inc.)
- NFLX (Netflix Inc.)

## Usage

1. **Browse Stocks**: View all stocks on the main dashboard
2. **Search**: Use the search box to filter stocks by symbol or name
3. **View Details**: Click on any stock card to see detailed information
4. **Price History**: View 30-day price history chart on the detail page
5. **Navigate Back**: Use the "Back to Dashboard" button to return

## Notes

- The backend fetches real-time data from Finnhub API
- Stock prices update when you refresh the page
- The application requires both backend and frontend to be running
- CORS is enabled on the backend to allow frontend requests

## Troubleshooting

If you encounter any issues:

1. **Backend not responding**: Check if the backend server is running on port 3000
2. **Frontend errors**: Ensure the backend is running before starting the frontend
3. **No data displayed**: Check the browser console for errors and verify the Finnhub API key is valid
4. **CORS errors**: Make sure the backend CORS is properly configured (already done)

## API Rate Limits

Finnhub API has rate limits on the free tier:
- 60 API calls per minute
- Consider implementing caching if you need more frequent updates
