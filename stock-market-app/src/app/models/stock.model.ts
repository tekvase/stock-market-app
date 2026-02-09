export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: string;
  high: number;
  low: number;
  open: number;
  previousClose?: number;
  stopLoss?: number;
  buyPrice?: number;
  targetPrice?: number;
}

export interface StockHistory {
  date: string;
  price: number;
}

export interface NewsItem {
  title: string;
  source: string;
  time: string;
  url?: string;
  sentiment?: string;
  sentimentLabel?: string;
}
