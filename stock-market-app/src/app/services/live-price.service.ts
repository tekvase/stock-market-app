import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
}

export interface PriceAlert {
  userId: number;
  symbol: string;
  alertType: string;
  thresholdPct: number;
  currentPrice: number;
  buyPrice: number;
  message: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class LivePriceService implements OnDestroy {
  private socket: Socket | null = null;
  private priceUpdates$ = new Subject<PriceUpdate>();
  private alertUpdates$ = new Subject<PriceAlert>();
  private subscribedSymbols = new Set<string>();

  public onPriceUpdate$ = this.priceUpdates$.asObservable();
  public onAlert$ = this.alertUpdates$.asObservable();

  constructor() {
    this.connect();
  }

  private connect(): void {
    this.socket = io(environment.wsUrl, {
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('[LivePrice] Connected to server');

      // Re-subscribe after reconnect
      if (this.subscribedSymbols.size > 0) {
        this.socket?.emit('subscribe', Array.from(this.subscribedSymbols));
      }
    });

    this.socket.on('price-update', (data: PriceUpdate) => {
      this.priceUpdates$.next(data);
    });

    this.socket.on('price-alert', (data: PriceAlert) => {
      this.alertUpdates$.next(data);
    });

    this.socket.on('disconnect', () => {
      console.log('[LivePrice] Disconnected from server');
    });
  }

  subscribe(symbols: string[]): void {
    const newSymbols = symbols.filter(s => !this.subscribedSymbols.has(s.toUpperCase()));
    newSymbols.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));

    if (newSymbols.length > 0 && this.socket?.connected) {
      this.socket.emit('subscribe', newSymbols);
      console.log('[LivePrice] Subscribed to:', newSymbols);
    }
  }

  unsubscribe(symbol: string): void {
    const upper = symbol.toUpperCase();
    if (!this.subscribedSymbols.has(upper)) return;

    this.subscribedSymbols.delete(upper);
    if (this.socket?.connected) {
      this.socket.emit('unsubscribe', upper);
      console.log('[LivePrice] Unsubscribed from:', upper);
    }
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.priceUpdates$.complete();
    this.alertUpdates$.complete();
  }
}
