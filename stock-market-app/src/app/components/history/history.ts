import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { StockService } from '../../services/stock.service';

@Component({
  selector: 'app-history',
  imports: [CommonModule, RouterModule],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class History implements OnInit {
  trades: any[] = [];
  loading = true;

  constructor(private stockService: StockService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.stockService.getTradeHistory().subscribe({
      next: (data) => {
        this.trades = data;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  get totalTrades(): number {
    return this.trades.length;
  }

  get totalPL(): number {
    return this.trades.reduce((sum, t) => sum + t.pl, 0);
  }

  get winCount(): number {
    return this.trades.filter(t => t.pl >= 0).length;
  }

  get winRate(): number {
    if (this.trades.length === 0) return 0;
    return (this.winCount / this.trades.length) * 100;
  }

  getPLPercent(trade: any): number {
    if (!trade.buyPrice || trade.buyPrice === 0) return 0;
    return ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * 100;
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
