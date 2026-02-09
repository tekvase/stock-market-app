import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { Stock, NewsItem } from '../../models/stock.model';
import { StockService } from '../../services/stock.service';
import { AuthService } from '../../services/auth.service';
import { LivePriceService } from '../../services/live-price.service';

@Component({
  selector: 'app-stock-list',
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './stock-list.html',
  styleUrl: './stock-list.css',
})
export class StockList implements OnInit, OnDestroy {
  stocks: any[] = [];
  loading = true;
  searchTerm = '';
  searchingSymbol = false;
  searchError = '';
  news: NewsItem[] = [];
  loadingNews = true;
  private newsRefreshSubscription?: Subscription;
  private livePriceSubscription?: Subscription;
  searchResult: Stock | null = null;
  showSearchPopup = false;

  weeklyEarnings: any[] = [];
  loadingEarnings = true;
  earningsWeekLabel = '';

  userEmail = '';
  userName = '';

  editingSymbol: string | null = null;
  editBuyPrice: number = 0;

  tabs = [
    { id: 'watchlist', label: 'Stock Watch List' },
    { id: 'recommendations', label: 'Daily Recommendation' },
    { id: 'earnings', label: 'Weekly Earnings' },
    { id: 'news', label: 'News' }
  ];
  activeTab = 'watchlist';

  selectTab(tabId: string): void {
    this.activeTab = tabId;
  }

  onTabKeydown(event: KeyboardEvent, index: number): void {
    let newIndex = index;
    if (event.key === 'ArrowRight') {
      newIndex = (index + 1) % this.tabs.length;
    } else if (event.key === 'ArrowLeft') {
      newIndex = (index - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      newIndex = 0;
    } else if (event.key === 'End') {
      newIndex = this.tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.activeTab = this.tabs[newIndex].id;
    const tabEl = document.getElementById('tab-' + this.tabs[newIndex].id);
    tabEl?.focus();
  }

  constructor(
    private stockService: StockService,
    private cdr: ChangeDetectorRef,
    private authService: AuthService,
    private livePriceService: LivePriceService
  ) {
    const user = this.authService.getCurrentUser();
    this.userEmail = user?.email || '';
    const first = user?.firstName || '';
    const last = user?.lastName || '';
    this.userName = (first + ' ' + last).trim();
  }

  ngOnInit(): void {
    this.loadUserTrades();
    this.loadWeeklyEarnings();
    this.loadNews();
    this.startNewsAutoRefresh();
    this.startLivePriceUpdates();
  }

  ngOnDestroy(): void {
    if (this.newsRefreshSubscription) {
      this.newsRefreshSubscription.unsubscribe();
    }
    if (this.livePriceSubscription) {
      this.livePriceSubscription.unsubscribe();
    }
  }

  startLivePriceUpdates(): void {
    this.livePriceSubscription = this.livePriceService.onPriceUpdate$.subscribe((update) => {
      const stock = this.stocks.find(s => s.symbol === update.symbol);
      if (stock) {
        stock.change = +(update.price - stock.price).toFixed(4);
        stock.price = update.price;
        this.cdr.detectChanges();
      }
    });
  }

  startNewsAutoRefresh(): void {
    this.newsRefreshSubscription = interval(30000).subscribe(() => {
      console.log('Auto-refreshing news...');
      this.loadNews();
    });
  }

  loadUserTrades(): void {
    this.loading = true;
    this.stockService.getUserTrades().subscribe({
      next: (trades) => {
        console.log('Loaded user trades:', trades);
        // For each trade, fetch current price from Finnhub
        this.stocks = trades.map((trade: any) => ({
          symbol: trade.symbol,
          name: trade.symbol,
          price: trade.buy_price, // will be updated with live price
          buyPrice: trade.buy_price,
          targetPrice1: trade.target_price_1,
          targetPrice2: trade.target_price_2,
          targetPrice3: trade.target_price_3,
          stopLoss: trade.stop_loss_price,
          status: trade.status,
          change: 0,
          changePercent: 0
        }));

        // Fetch initial prices via REST, then subscribe to WebSocket for live updates
        const symbols = this.stocks.map(s => s.symbol);
        this.stocks.forEach((stock, index) => {
          this.stockService.getStockBySymbol(stock.symbol).subscribe({
            next: (data) => {
              this.stocks[index] = {
                ...this.stocks[index],
                name: data.name || stock.symbol,
                price: data.price,
                change: data.change,
                changePercent: data.changePercent
              };
              this.cdr.detectChanges();
            },
            error: () => {} // keep existing data on error
          });
        });

        // Subscribe to live price updates via WebSocket
        if (symbols.length > 0) {
          this.livePriceService.subscribe(symbols);
        }

        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading trades:', error);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadNews(): void {
    this.loadingNews = true;
    this.stockService.getNews('general').subscribe({
      next: (data) => {
        this.news = data.slice(0, 10).map(item => ({
          title: item.title,
          source: item.source,
          time: item.time,
          url: item.url,
          sentiment: item.sentiment,
          sentimentLabel: item.sentimentLabel
        }));
        this.loadingNews = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading news:', error);
        this.loadingNews = false;
        this.news = [];
      }
    });
  }

  getFilteredStocks(): any[] {
    if (!this.searchTerm) {
      return this.stocks;
    }
    const term = this.searchTerm.toLowerCase();
    return this.stocks.filter(stock =>
      stock.symbol.toLowerCase().includes(term) ||
      stock.name.toLowerCase().includes(term)
    );
  }

  onSearchChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm = value;
    this.searchError = '';
  }

  onSearchSubmit(event: Event): void {
    event.preventDefault();
    if (this.searchTerm.trim()) {
      this.performSearch(this.searchTerm.trim());
    }
  }

  performSearch(searchValue: string): void {
    const symbol = searchValue.toUpperCase();
    const existingStock = this.stocks.find(s => s.symbol === symbol);

    if (existingStock) {
      this.searchError = `${symbol} is already in your list`;
      return;
    }

    this.searchingSymbol = true;
    this.searchError = '';

    this.stockService.getStockBySymbol(symbol).subscribe({
      next: (data) => {
        this.searchResult = data;
        this.showSearchPopup = true;
        this.searchingSymbol = false;
        this.searchTerm = '';
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error searching for stock:', error);
        this.searchError = `Stock "${symbol}" not found`;
        this.searchingSymbol = false;
        this.cdr.detectChanges();
      }
    });
  }

  addStockFromPopup(): void {
    if (this.searchResult) {
      const stock = this.searchResult;
      // Save to database via API
      this.stockService.addUserTrade(stock.symbol, stock.price).subscribe({
        next: (trade) => {
          console.log('Trade added:', trade);
          // Add to local list with calculated prices from backend
          this.stocks = [{
            symbol: trade.symbol,
            name: stock.name || trade.symbol,
            price: stock.price,
            buyPrice: trade.buy_price,
            targetPrice1: trade.target_price_1,
            targetPrice2: trade.target_price_2,
            targetPrice3: trade.target_price_3,
            stopLoss: trade.stop_loss_price,
            status: trade.status,
            change: stock.change || 0,
            changePercent: stock.changePercent || 0
          }, ...this.stocks];
          // Subscribe to live price for the new symbol
          this.livePriceService.subscribe([trade.symbol]);
          this.closeSearchPopup();
          this.cdr.detectChanges();
        },
        error: (error) => {
          console.error('Error adding trade:', error);
          this.searchError = error.error?.error || 'Failed to add stock';
          this.closeSearchPopup();
          this.cdr.detectChanges();
        }
      });
    }
  }

  deleteStock(symbol: string): void {
    this.stockService.deleteUserTrade(symbol).subscribe({
      next: () => {
        this.stocks = this.stocks.filter(s => s.symbol !== symbol);
        // Unsubscribe from live price updates
        this.livePriceService.unsubscribe(symbol);
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error deleting trade:', error);
      }
    });
  }

  startEditBuyPrice(stock: any): void {
    this.editingSymbol = stock.symbol;
    this.editBuyPrice = stock.buyPrice;
  }

  cancelEditBuyPrice(): void {
    this.editingSymbol = null;
  }

  saveBuyPrice(stock: any): void {
    if (this.editBuyPrice <= 0) return;

    this.stockService.updateUserTrade(stock.symbol, this.editBuyPrice).subscribe({
      next: (updated) => {
        stock.buyPrice = updated.buy_price;
        stock.targetPrice1 = updated.target_price_1;
        stock.targetPrice2 = updated.target_price_2;
        stock.targetPrice3 = updated.target_price_3;
        stock.stopLoss = updated.stop_loss_price;
        this.editingSymbol = null;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error updating buy price:', error);
        this.editingSymbol = null;
      }
    });
  }

  onEditKeydown(event: KeyboardEvent, stock: any): void {
    if (event.key === 'Enter') {
      this.saveBuyPrice(stock);
    } else if (event.key === 'Escape') {
      this.cancelEditBuyPrice();
    }
  }

  logout(): void {
    this.authService.logout();
  }

  loadWeeklyEarnings(): void {
    this.loadingEarnings = true;
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    this.earningsWeekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    this.stockService.getWeeklyEarnings(
      monday.toISOString().split('T')[0],
      friday.toISOString().split('T')[0]
    ).subscribe({
      next: (data) => {
        this.weeklyEarnings = data.earnings || [];
        this.loadingEarnings = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading weekly earnings:', error);
        this.weeklyEarnings = [];
        this.loadingEarnings = false;
        this.cdr.detectChanges();
      }
    });
  }

  getPriceDiffPercent(stock: any): number {
    if (!stock.buyPrice || stock.buyPrice === 0) return 0;
    return ((stock.price - stock.buyPrice) / stock.buyPrice) * 100;
  }

  getEarningsTime(time: string): string {
    if (time === 'bmo') return 'Before Open';
    if (time === 'amc') return 'After Close';
    return time || '-';
  }

  getEpsTooltip(eps: number): string {
    if (eps < 0) return `EPS: ${eps.toFixed(3)} — Loss (company is losing money)`;
    if (eps <= 1) return `EPS: ${eps.toFixed(3)} — Very low profit / near break-even`;
    if (eps <= 5) return `EPS: ${eps.toFixed(3)} — Normal, modestly profitable`;
    return `EPS: ${eps.toFixed(3)} — Strong, healthy business`;
  }

  formatRevenue(value: number | null): string {
    if (value === null || value === undefined) return '-';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(3)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(3)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(3)}K`;
    return `${sign}$${abs.toFixed(3)}`;
  }

  closeSearchPopup(): void {
    this.showSearchPopup = false;
    this.searchResult = null;
    this.searchError = '';
  }
}
