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

  getMonthlyEarnings(from?: string, to?: string): Observable<any> {
    let url = `${this.apiUrl}/earnings/monthly`;
    const params: string[] = [];
    if (from) params.push(`from=${from}`);
    if (to) params.push(`to=${to}`);
    if (params.length) url += `?${params.join('&')}`;
    return this.http.get<any>(url).pipe(
      catchError(error => {
        console.error('Error fetching monthly earnings:', error);
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
}
