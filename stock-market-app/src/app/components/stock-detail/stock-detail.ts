import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { Stock, StockHistory, NewsItem } from '../../models/stock.model';
import { StockService } from '../../services/stock.service';
import { LivePriceService } from '../../services/live-price.service';

@Component({
  selector: 'app-stock-detail',
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './stock-detail.html',
  styleUrl: './stock-detail.css',
})
export class StockDetail implements OnInit, OnDestroy {
  stock?: Stock;
  stockHistory: StockHistory[] = [];
  details: any = null;
  companyNews: any[] = [];
  loading = true;
  loadingDetails = true;
  loadingNews = true;
  symbol = '';
  private livePriceSub?: Subscription;

  // Close position
  showCloseDialog = false;
  closeSellPrice: number = 0;
  closingPosition = false;
  tradeData: any = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private stockService: StockService,
    private livePriceService: LivePriceService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.symbol = params['symbol'];
      this.loadAll();
    });
  }

  ngOnDestroy(): void {
    if (this.livePriceSub) {
      this.livePriceSub.unsubscribe();
    }
  }

  loadAll(): void {
    this.loading = true;
    this.loadingDetails = true;
    this.loadingNews = true;

    this.stockService.getStockBySymbol(this.symbol).subscribe({
      next: (data) => {
        this.stock = data;
        this.loading = false;
        this.loadStockHistory();
        this.startLivePrice();
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });

    this.stockService.getStockDetails(this.symbol).subscribe({
      next: (data) => {
        this.details = data;
        this.loadingDetails = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingDetails = false;
        this.cdr.detectChanges();
      }
    });

    // Load trade data to check if this stock is in the user's watchlist
    this.stockService.getUserTrades().subscribe({
      next: (trades) => {
        const trade = trades.find((t: any) => t.symbol === this.symbol);
        if (trade) {
          this.tradeData = {
            symbol: trade.symbol,
            buyPrice: trade.buy_price,
            shares: trade.shares || 0
          };
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });

    this.stockService.getCompanyNews(this.symbol).subscribe({
      next: (data) => {
        this.companyNews = data.slice(0, 8);
        this.loadingNews = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingNews = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadStockHistory(): void {
    this.stockService.getStockHistory(this.symbol).subscribe({
      next: (data) => {
        this.stockHistory = data;
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  startLivePrice(): void {
    this.livePriceService.subscribe([this.symbol]);
    this.livePriceSub = this.livePriceService.onPriceUpdate$.subscribe((update) => {
      if (this.stock && update.symbol === this.symbol) {
        this.stock.change = +(update.price - (this.stock.price - this.stock.change)).toFixed(4);
        this.stock.price = update.price;
        this.cdr.detectChanges();
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  getMaxPrice(): number {
    if (this.stockHistory.length === 0) return 0;
    return Math.max(...this.stockHistory.map(h => h.price));
  }

  getMinPrice(): number {
    if (this.stockHistory.length === 0) return 0;
    return Math.min(...this.stockHistory.map(h => h.price));
  }

  getBarHeight(price: number): number {
    const max = this.getMaxPrice();
    const min = this.getMinPrice();
    if (max === min) return 50;
    return ((price - min) / (max - min)) * 90 + 10;
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatMarketCap(value: number | null): string {
    if (!value) return 'N/A';
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}T`;
    if (value >= 1) return `$${value.toFixed(1)}B`;
    return `$${(value * 1000).toFixed(0)}M`;
  }

  getRecommendationTotal(rec: any): number {
    return (rec.strongBuy || 0) + (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0) + (rec.strongSell || 0);
  }

  // Close position
  openCloseDialog(): void {
    this.showCloseDialog = true;
    this.closeSellPrice = 0;
  }

  cancelCloseDialog(): void {
    this.showCloseDialog = false;
    this.closeSellPrice = 0;
  }

  getClosePL(): number {
    if (!this.tradeData || !this.closeSellPrice || !this.tradeData.buyPrice) return 0;
    return (this.closeSellPrice - this.tradeData.buyPrice) * (this.tradeData.shares || 1);
  }

  getClosePLPercent(): number {
    if (!this.tradeData || !this.closeSellPrice || !this.tradeData.buyPrice || this.tradeData.buyPrice === 0) return 0;
    return ((this.closeSellPrice - this.tradeData.buyPrice) / this.tradeData.buyPrice) * 100;
  }

  closePosition(): void {
    if (!this.tradeData) return;
    this.closingPosition = true;

    const doDelete = () => {
      this.stockService.deleteUserTrade(this.symbol).subscribe({
        next: () => {
          this.closingPosition = false;
          this.showCloseDialog = false;
          this.tradeData = null;
          this.cdr.detectChanges();
        },
        error: () => {
          this.closingPosition = false;
          this.cdr.detectChanges();
        }
      });
    };

    if (this.closeSellPrice > 0) {
      this.stockService.updateTradeFields(this.symbol, { sellPrice: this.closeSellPrice }).subscribe({
        next: () => doDelete(),
        error: () => doDelete()
      });
    } else {
      doDelete();
    }
  }
}
