import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Stock, StockHistory } from '../models/stock.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class StockService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  constructor() {
    console.log('StockService initialized with API URL:', this.apiUrl);
  }

  getStocks(): Observable<Stock[]> {
    console.log('Calling getStocks API...');
    return this.http.get<Stock[]>(`${this.apiUrl}/stocks`).pipe(
      tap(data => console.log('Received stocks data:', data)),
      catchError(error => {
        console.error('Error fetching stocks:', error);
        throw error;
      })
    );
  }

  getStockBySymbol(symbol: string): Observable<Stock> {
    console.log('Calling getStockBySymbol API for:', symbol);
    return this.http.get<Stock>(`${this.apiUrl}/stock/${symbol}`).pipe(
      tap(data => console.log('Received stock data for', symbol, ':', data)),
      catchError(error => {
        console.error('Error fetching stock detail:', error);
        throw error;
      })
    );
  }

  getStockHistory(symbol: string, days: number = 30): Observable<StockHistory[]> {
    console.log('Calling getStockHistory API for:', symbol);
    return this.http.get<StockHistory[]>(`${this.apiUrl}/stock/${symbol}/history?days=${days}`).pipe(
      tap(data => console.log('Received history data for', symbol, ':', data.length, 'points')),
      catchError(error => {
        console.error('Error fetching stock history:', error);
        throw error;
      })
    );
  }

  searchStocks(query: string): Observable<any[]> {
    console.log('Calling searchStocks API for:', query);
    return this.http.get<any[]>(`${this.apiUrl}/search?query=${query}`).pipe(
      tap(data => console.log('Received search results:', data)),
      catchError(error => {
        console.error('Error searching stocks:', error);
        throw error;
      })
    );
  }

  getNews(category: string = 'general'): Observable<any[]> {
    console.log('Calling getNews API...');
    return this.http.get<any[]>(`${this.apiUrl}/news?category=${category}`).pipe(
      tap(data => console.log('Received news data:', data)),
      catchError(error => {
        console.error('Error fetching news:', error);
        throw error;
      })
    );
  }

  getCompanyNews(symbol: string): Observable<any[]> {
    console.log('Calling getCompanyNews API for:', symbol);
    return this.http.get<any[]>(`${this.apiUrl}/news/${symbol}`).pipe(
      tap(data => console.log('Received company news for', symbol, ':', data)),
      catchError(error => {
        console.error('Error fetching company news:', error);
        throw error;
      })
    );
  }

  // User stock trades
  private getAuthHeaders() {
    const token = localStorage.getItem('authToken');
    return { Authorization: `Bearer ${token}` };
  }

  getUserTrades(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/trades`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error fetching trades:', error);
        throw error;
      })
    );
  }

  addUserTrade(symbol: string, currentPrice: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/trades`, { symbol, currentPrice }, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error adding trade:', error);
        throw error;
      })
    );
  }

  getMonthlyEarnings(from?: string, to?: string, symbols?: string[]): Observable<any> {
    let url = `${this.apiUrl}/earnings/monthly`;
    const params: string[] = [];
    if (from) params.push(`from=${from}`);
    if (to) params.push(`to=${to}`);
    if (symbols && symbols.length > 0) params.push(`symbols=${symbols.join(',')}`);
    if (params.length) url += `?${params.join('&')}`;
    return this.http.get<any>(url).pipe(
      catchError(error => {
        console.error('Error fetching monthly earnings:', error);
        throw error;
      })
    );
  }

  getUserEarningsSymbols(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/earnings/user-symbols`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error fetching user earnings symbols:', error);
        return of([]);
      })
    );
  }

  addEarningsSymbol(symbol: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/earnings/symbols`, { symbol }, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error adding earnings symbol:', error);
        throw error;
      })
    );
  }

  removeEarningsSymbol(symbol: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/earnings/symbols/${symbol}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error removing earnings symbol:', error);
        throw error;
      })
    );
  }

  getStockDetails(symbol: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/stock/${symbol}/details`).pipe(
      catchError(error => {
        console.error('Error fetching stock details:', error);
        throw error;
      })
    );
  }

  getMetricExplanations(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/metric-explanations`).pipe(
      catchError(error => {
        console.error('Error fetching metric explanations:', error);
        return of([]);
      })
    );
  }

  updateUserTrade(symbol: string, buyPrice: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/trades/${symbol}`, { buyPrice }, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error updating trade:', error);
        throw error;
      })
    );
  }

  updateTradeFields(symbol: string, fields: { shares?: number; sellPrice?: number }): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/trades/${symbol}`, fields, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error updating trade fields:', error);
        throw error;
      })
    );
  }

  getMonthlyPL(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/trades/monthly-pl`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error fetching monthly P&L:', error);
        return of({ totalPL: 0, details: [] });
      })
    );
  }

  // Option trades
  getUserOptionTrades(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/option-trades`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error fetching option trades:', error);
        return of([]);
      })
    );
  }

  addUserOptionTrade(data: { symbol: string; optionType: string; strike: number; expiry: string; premiumPaid: number; contracts: number; side: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/option-trades`, data, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error adding option trade:', error);
        throw error;
      })
    );
  }

  deleteUserOptionTrade(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/option-trades/${id}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error deleting option trade:', error);
        throw error;
      })
    );
  }

  getOptionsChain(symbol: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/options-chain/${symbol}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error fetching options chain:', error);
        return of(null);
      })
    );
  }

  deleteUserTrade(symbol: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/trades/${symbol}`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error deleting trade:', error);
        throw error;
      })
    );
  }

  getDailyPicks(params?: {
    priceMin?: number;
    priceMax?: number;
    category?: string;
    sortBy?: string;
    limit?: number;
    offset?: number;
  }): Observable<any> {
    let url = `${this.apiUrl}/recommendations/daily`;
    const queryParams: string[] = [];
    if (params?.priceMin !== undefined) queryParams.push(`priceMin=${params.priceMin}`);
    if (params?.priceMax !== undefined) queryParams.push(`priceMax=${params.priceMax}`);
    if (params?.category) queryParams.push(`category=${encodeURIComponent(params.category)}`);
    if (params?.sortBy) queryParams.push(`sortBy=${params.sortBy}`);
    if (params?.limit) queryParams.push(`limit=${params.limit}`);
    if (params?.offset) queryParams.push(`offset=${params.offset}`);
    if (queryParams.length > 0) url += '?' + queryParams.join('&');

    return this.http.get<any>(url).pipe(
      catchError(error => {
        console.error('Error fetching daily picks:', error);
        return of({ date: null, picks: [], totalCount: 0, categories: [] });
      })
    );
  }

  getMarketIndices(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/market-indices`).pipe(
      catchError(error => {
        console.error('Error fetching market indices:', error);
        return of([]);
      })
    );
  }

  getEarningsAnalysis(symbol: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/earnings/analysis/${symbol}`).pipe(
      catchError(error => {
        console.error('Error fetching earnings analysis:', error);
        throw error;
      })
    );
  }

  getTradeHistory(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/trades/history`, { headers: this.getAuthHeaders() }).pipe(
      catchError(error => {
        console.error('Error fetching trade history:', error);
        throw error;
      })
    );
  }

  // Dev dashboard
  checkAdmin(): Observable<{ isAdmin: boolean; email: string }> {
    return this.http.get<{ isAdmin: boolean; email: string }>(`${this.apiUrl}/dev/check-admin`, { headers: this.getAuthHeaders() }).pipe(
      catchError(() => of({ isAdmin: false, email: '' }))
    );
  }

  getDevStatus(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/dev/status`, { headers: this.getAuthHeaders() });
  }

  triggerJob(job: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/dev/trigger/${job}`, {}, { headers: this.getAuthHeaders() });
  }

  addManualEarning(symbol: string, date: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/earnings/manual`, { symbol, date }, { headers: this.getAuthHeaders() });
  }

  // Price Alerts
  getAlertHistory(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/alerts`, { headers: this.getAuthHeaders() }).pipe(
      catchError(() => of([]))
    );
  }

  // Market Intelligence
  getSectorPerformance(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/market/sectors`).pipe(
      catchError(() => of([]))
    );
  }

  getInsiderTrades(symbols: string[]): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/market/insider-trades`, {
      params: { symbols: symbols.join(',') },
      headers: this.getAuthHeaders()
    }).pipe(catchError(() => of([])));
  }

  getSentimentData(symbols: string[]): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/market/sentiment`, {
      params: { symbols: symbols.join(',') }
    }).pipe(catchError(() => of([])));
  }

  // Market Conditions (regime + adjustments)
  getMarketConditions(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/market/conditions`).pipe(
      catchError(() => of({ regime: 'neutral', adjustments: {} }))
    );
  }

  // Buy/Sell Signals
  getSignals(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/signals`, { headers: this.getAuthHeaders() }).pipe(
      catchError(() => of([]))
    );
  }

  // Market Indices with Sparkline chart data
  getMarketIndicesCharts(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/market-indices/charts`).pipe(
      catchError(error => {
        console.error('Error fetching market indices charts:', error);
        return of([]);
      })
    );
  }
}
