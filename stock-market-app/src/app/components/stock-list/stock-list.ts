import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
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
  newsFilter: string = 'all';
  newsDisplayCount: number = 10;
  private newsRefreshSubscription?: Subscription;
  private livePriceSubscription?: Subscription;
  searchResult: Stock | null = null;
  searchDetails: any = null;
  loadingDetails = false;
  showSearchPopup = false;
  metricExplanations: any[] = [];

  monthlyEarnings: any[] = [];
  loadingEarnings = true;
  earningsMonthLabel = '';
  earningsMonth: Date = new Date();
  earningsStartMonth: Date = new Date(); // first of the 3 loaded months
  earningsMonthIndex: number = 0; // 0, 1, or 2 within the 3-month window
  earningsSearchTerm = '';
  earningsMyStocksOnly = false;

  userEmail = '';
  userName = '';
  showDetails = false;
  canViewStockPage = false;

  editingSymbol: string | null = null;
  editBuyPrice: number = 0;
  deleteConfirmSymbol: string | null = null;
  deleteSellPrice: number = 0;

  // Monthly P&L
  monthlyPL: number = 0;
  monthlyPLDetails: any[] = [];
  loadingMonthlyPL = false;

  // Sorting
  sortColumn: string = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Options data
  userOptions: any[] = [];
  loadingOptions = false;
  optionsSortColumn: string = '';
  optionsSortDirection: 'asc' | 'desc' = 'asc';

  // Add option form
  showAddOptionForm = false;
  optionSearchTerm = '';
  optionSearching = false;
  optionSearchError = '';
  optionChainData: any = null;
  optionChainExpiries: string[] = [];
  selectedExpiry = '';
  optionChainOptions: any[] = [];
  newOption = { symbol: '', optionType: 'Call' as string, strike: 0, expiry: '', premiumPaid: 0, contracts: 1, side: 'Buy' as string };
  addingOption = false;
  deleteOptionConfirmId: number | null = null;

  // Earnings analysis
  earningsAnalysis: any = null;
  loadingAnalysis = false;
  showAnalysisPopup = false;
  analysisError = '';

  allTabs = [
    { id: 'watchlist', label: 'Stock Watch List', minAccess: 1 },
    { id: 'options', label: 'Options', minAccess: 1 },
    { id: 'recommendations', label: 'Daily Recommendation', minAccess: 2 },
    { id: 'earnings', label: 'Monthly Earnings', minAccess: 2 },
    { id: 'news', label: 'News', minAccess: 3 }
  ];
  tabs: { id: string; label: string; minAccess: number }[] = [];
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
    private livePriceService: LivePriceService,
    private router: Router
  ) {
    const user = this.authService.getCurrentUser();
    this.userEmail = user?.email || '';
    const first = user?.firstName || '';
    const last = user?.lastName || '';
    this.userName = (first + ' ' + last).trim();
    this.showDetails = user?.accessCode === 10 || user?.accessCode === 3;
    this.canViewStockPage = (user?.accessCode ?? 1) >= 2;
    const accessCode = user?.accessCode ?? 1;
    this.tabs = this.allTabs.filter(tab => accessCode >= tab.minAccess);
  }

  ngOnInit(): void {
    this.loadUserTrades();
    this.loadMonthlyEarnings();
    this.loadNews();
    this.startNewsAutoRefresh();
    this.startLivePriceUpdates();
    this.loadMetricExplanations();
    this.loadMonthlyPL();
    this.loadUserOptions();
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
    this.newsRefreshSubscription = interval(600000).subscribe(() => {
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
          shares: trade.shares || 0,
          sellPrice: trade.sell_price ? parseFloat(trade.sell_price) : 0,
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
        this.news = data.map((item: any) => ({
          title: item.title,
          source: item.source,
          time: item.time,
          url: item.url,
          sentiment: item.sentiment,
          sentimentLabel: item.sentimentLabel,
          image: item.image || '',
          summary: item.summary || '',
          expanded: false
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

  refreshNews(): void {
    this.newsDisplayCount = 10;
    this.loadNews();
  }

  getFilteredNews(): NewsItem[] {
    let filtered = this.news;
    if (this.newsFilter !== 'all') {
      filtered = filtered.filter(n => n.sentiment === this.newsFilter);
    }
    return filtered.slice(0, this.newsDisplayCount);
  }

  setNewsFilter(filter: string): void {
    this.newsFilter = filter;
    this.newsDisplayCount = 10;
    this.cdr.detectChanges();
  }

  loadMoreNews(): void {
    this.newsDisplayCount += 10;
    this.cdr.detectChanges();
  }

  hasMoreNews(): boolean {
    let filtered = this.news;
    if (this.newsFilter !== 'all') {
      filtered = filtered.filter(n => n.sentiment === this.newsFilter);
    }
    return this.newsDisplayCount < filtered.length;
  }

  toggleNewsSummary(item: NewsItem): void {
    item.expanded = !item.expanded;
    this.cdr.detectChanges();
  }

  isWatchlistRelated(title: string): string[] {
    return this.stocks.filter(s => {
      const symRegex = new RegExp(`\\b${s.symbol}\\b`, 'i');
      if (symRegex.test(title)) return true;
      if (s.name && s.name.length > 2) {
        const nameRegex = new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (nameRegex.test(title)) return true;
        // Also check first word of name (e.g. "Apple" from "Apple Inc")
        const firstName = s.name.split(/\s+/)[0];
        if (firstName.length > 3) {
          const firstRegex = new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (firstRegex.test(title)) return true;
        }
      }
      return false;
    }).map(s => s.symbol);
  }

  getFilteredStocks(): any[] {
    let filtered = this.stocks;
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(stock =>
        stock.symbol.toLowerCase().includes(term) ||
        stock.name.toLowerCase().includes(term)
      );
    }
    if (this.sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let valA: any, valB: any;
        switch (this.sortColumn) {
          case 'symbol': valA = a.symbol; valB = b.symbol; break;
          case 'price': valA = a.price; valB = b.price; break;
          case 'buyPrice': valA = a.buyPrice; valB = b.buyPrice; break;
          case 'pct': valA = this.getPriceDiffPercent(a); valB = this.getPriceDiffPercent(b); break;
          case 'change': valA = a.change; valB = b.change; break;
          case 'stopLoss': valA = a.stopLoss; valB = b.stopLoss; break;
          case 'target1': valA = a.targetPrice1; valB = b.targetPrice1; break;
          case 'target2': valA = a.targetPrice2; valB = b.targetPrice2; break;
          case 'target3': valA = a.targetPrice3; valB = b.targetPrice3; break;
          case 'shares': valA = a.shares || 0; valB = b.shares || 0; break;
          case 'weight': valA = this.getStockWeight(a); valB = this.getStockWeight(b); break;
          case 'sellPrice': valA = a.sellPrice || 0; valB = b.sellPrice || 0; break;
          case 'pl': valA = this.getPLPercent(a); valB = this.getPLPercent(b); break;
          default: return 0;
        }
        if (typeof valA === 'string') {
          const cmp = valA.localeCompare(valB);
          return this.sortDirection === 'asc' ? cmp : -cmp;
        }
        return this.sortDirection === 'asc' ? valA - valB : valB - valA;
      });
    }
    return filtered;
  }

  toggleSort(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = column === 'pct' ? 'desc' : 'asc';
    }
    this.cdr.detectChanges();
  }

  getSortIcon(column: string): string {
    if (this.sortColumn !== column) return '⇅';
    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  // Status indicator for each stock
  getStockStatus(stock: any): { label: string; class: string } {
    if (stock.price <= stock.stopLoss) {
      return { label: 'Stop Loss', class: 'status-stop-loss' };
    }
    const nearStopPct = ((stock.price - stock.stopLoss) / stock.stopLoss) * 100;
    if (nearStopPct <= 3) {
      return { label: 'Near Stop', class: 'status-near-stop' };
    }
    if (stock.price >= stock.targetPrice3) {
      return { label: 'Target 3', class: 'status-target-hit' };
    }
    if (stock.price >= stock.targetPrice2) {
      return { label: 'Target 2', class: 'status-target-hit' };
    }
    if (stock.price >= stock.targetPrice1) {
      return { label: 'Target 1', class: 'status-target-hit' };
    }
    return { label: 'In Range', class: 'status-in-range' };
  }

  // Check if target has been hit
  isTargetHit(stock: any, target: number): boolean {
    return stock.price >= target;
  }

  isStopLossHit(stock: any): boolean {
    return stock.price <= stock.stopLoss;
  }

  // Portfolio summary
  getPortfolioSummary(): { total: number; inProfit: number; inLoss: number; avgReturn: number; totalProfit: number } {
    const stocks = this.stocks;
    if (stocks.length === 0) return { total: 0, inProfit: 0, inLoss: 0, avgReturn: 0, totalProfit: 0 };
    let inProfit = 0;
    let inLoss = 0;
    let totalPct = 0;
    let totalProfit = 0;
    for (const s of stocks) {
      const pct = this.getPriceDiffPercent(s);
      totalPct += pct;
      if (pct >= 0) inProfit++;
      else inLoss++;
      if (s.buyPrice > 0) {
        totalProfit += this.getCurrentPL(s);
      }
    }
    return {
      total: stocks.length,
      inProfit,
      inLoss,
      avgReturn: totalPct / stocks.length,
      totalProfit
    };
  }

  // Portfolio diversity
  getPortfolioDiversity(): { symbol: string; name: string; invested: number; currentValue: number; pct: number; pl: number; plPct: number }[] {
    const stocksWithInvestment = this.stocks.filter(s => s.buyPrice > 0 && (s.shares || 0) > 0);
    const totalInvested = stocksWithInvestment.reduce((sum, s) => sum + (s.buyPrice * (s.shares || 1)), 0);
    if (totalInvested === 0) return [];
    return stocksWithInvestment.map(s => {
      const invested = s.buyPrice * (s.shares || 1);
      const currentValue = s.price * (s.shares || 1);
      const pl = currentValue - invested;
      const plPct = invested > 0 ? (pl / invested) * 100 : 0;
      return {
        symbol: s.symbol,
        name: s.name,
        invested,
        currentValue,
        pct: (invested / totalInvested) * 100,
        pl,
        plPct
      };
    }).sort((a, b) => b.pct - a.pct);
  }

  getTotalInvested(): number {
    return this.stocks.filter(s => s.buyPrice > 0 && (s.shares || 0) > 0)
      .reduce((sum, s) => sum + (s.buyPrice * (s.shares || 1)), 0);
  }

  getTotalCurrentValue(): number {
    return this.stocks.filter(s => s.buyPrice > 0 && (s.shares || 0) > 0)
      .reduce((sum, s) => sum + (s.price * (s.shares || 1)), 0);
  }

  getOverallProfit(): number {
    return this.getTotalCurrentValue() - this.getTotalInvested();
  }

  getOverallProfitPct(): number {
    const invested = this.getTotalInvested();
    if (invested === 0) return 0;
    return (this.getOverallProfit() / invested) * 100;
  }

  getStockWeight(stock: any): number {
    if (!stock.buyPrice || stock.buyPrice <= 0 || !stock.shares || stock.shares <= 0) return 0;
    const totalInvested = this.getTotalInvested();
    if (totalInvested === 0) return 0;
    return ((stock.buyPrice * stock.shares) / totalInvested) * 100;
  }

  // Shares
  onSharesChange(stock: any, event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    stock.shares = isNaN(value) ? 0 : value;
    this.cdr.detectChanges();
    this.stockService.updateTradeFields(stock.symbol, { shares: stock.shares }).subscribe({
      next: () => { if (stock.sellPrice > 0) this.loadMonthlyPL(); },
      error: (err: any) => console.error('Error saving shares:', err)
    });
  }

  // Sell Price & P&L
  onSellPriceChange(stock: any, event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    stock.sellPrice = isNaN(value) ? 0 : value;
    this.cdr.detectChanges();
    this.stockService.updateTradeFields(stock.symbol, { sellPrice: stock.sellPrice }).subscribe({
      next: () => this.loadMonthlyPL(),
      error: (err: any) => console.error('Error saving sell price:', err)
    });
  }

  getPL(stock: any): number {
    if (!stock.sellPrice || !stock.buyPrice) return 0;
    return stock.sellPrice - stock.buyPrice;
  }

  getPLPercent(stock: any): number {
    if (!stock.sellPrice || !stock.buyPrice || stock.buyPrice === 0) return 0;
    return ((stock.sellPrice - stock.buyPrice) / stock.buyPrice) * 100;
  }

  getTotalPL(stock: any): number {
    const perShare = this.getPL(stock);
    const shares = stock.shares || 1;
    return perShare * shares;
  }

  getCurrentPL(stock: any): number {
    if (!stock.price || !stock.buyPrice) return 0;
    const shares = stock.shares || 1;
    return (stock.price - stock.buyPrice) * shares;
  }

  getCurrentPLPercent(stock: any): number {
    if (!stock.price || !stock.buyPrice || stock.buyPrice === 0) return 0;
    return ((stock.price - stock.buyPrice) / stock.buyPrice) * 100;
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
        this.searchDetails = null;
        this.loadingDetails = true;
        this.showSearchPopup = true;
        this.searchingSymbol = false;
        this.searchTerm = '';
        this.cdr.detectChanges();

        // Fetch additional details in parallel
        this.stockService.getStockDetails(symbol).subscribe({
          next: (details) => {
            this.searchDetails = details;
            this.loadingDetails = false;
            this.cdr.detectChanges();
          },
          error: () => {
            this.loadingDetails = false;
            this.cdr.detectChanges();
          }
        });
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

  confirmDelete(symbol: string): void {
    this.deleteConfirmSymbol = symbol;
    this.deleteSellPrice = 0;
  }

  cancelDelete(): void {
    this.deleteConfirmSymbol = null;
    this.deleteSellPrice = 0;
  }

  getDeleteStock(): any {
    return this.stocks.find(s => s.symbol === this.deleteConfirmSymbol);
  }

  getDeletePL(): number {
    const stock = this.getDeleteStock();
    if (!stock || !this.deleteSellPrice || !stock.buyPrice) return 0;
    return (this.deleteSellPrice - stock.buyPrice) * (stock.shares || 1);
  }

  getDeletePLPercent(): number {
    const stock = this.getDeleteStock();
    if (!stock || !this.deleteSellPrice || !stock.buyPrice || stock.buyPrice === 0) return 0;
    return ((this.deleteSellPrice - stock.buyPrice) / stock.buyPrice) * 100;
  }

  deleteStockWithSellPrice(symbol: string): void {
    // Save sell price first if provided, then delete
    if (this.deleteSellPrice > 0) {
      this.stockService.updateTradeFields(symbol, { sellPrice: this.deleteSellPrice }).subscribe({
        next: () => this.deleteStock(symbol),
        error: () => this.deleteStock(symbol) // Still delete even if sell price save fails
      });
    } else {
      this.deleteStock(symbol);
    }
  }

  deleteStock(symbol: string): void {
    this.deleteConfirmSymbol = null;
    this.deleteSellPrice = 0;
    this.stockService.deleteUserTrade(symbol).subscribe({
      next: () => {
        this.stocks = this.stocks.filter(s => s.symbol !== symbol);
        this.livePriceService.unsubscribe(symbol);
        this.loadMonthlyPL();
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

  loadMonthlyEarnings(): void {
    this.loadingEarnings = true;
    const today = new Date();
    this.earningsStartMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.earningsMonth = new Date(this.earningsStartMonth);
    this.earningsMonthIndex = 0;
    this.updateEarningsLabel();

    const firstDay = today;
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 3, 0);

    this.stockService.getMonthlyEarnings(
      firstDay.toISOString().split('T')[0],
      lastDay.toISOString().split('T')[0]
    ).subscribe({
      next: (data) => {
        this.monthlyEarnings = (data.earnings || []);
        this.loadingEarnings = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading monthly earnings:', error);
        this.monthlyEarnings = [];
        this.loadingEarnings = false;
        this.cdr.detectChanges();
      }
    });
  }

  updateEarningsLabel(): void {
    this.earningsMonthLabel = this.earningsMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  changeEarningsMonth(direction: number): void {
    const newIndex = this.earningsMonthIndex + direction;
    if (newIndex < 0 || newIndex > 2) return;
    this.earningsMonthIndex = newIndex;
    this.earningsMonth = new Date(
      this.earningsStartMonth.getFullYear(),
      this.earningsStartMonth.getMonth() + newIndex,
      1
    );
    this.updateEarningsLabel();
    this.cdr.detectChanges();
  }

  canGoPrevMonth(): boolean {
    return this.earningsMonthIndex > 0;
  }

  canGoNextMonth(): boolean {
    return this.earningsMonthIndex < 2;
  }

  onEarningsSearchChange(): void {
    this.cdr.detectChanges();
  }

  onEarningsFilterChange(): void {
    this.cdr.detectChanges();
  }

  getFilteredEarnings(): any[] {
    let filtered = this.monthlyEarnings;
    if (this.earningsMyStocksOnly) {
      const watchlistSymbols = this.stocks.map(s => s.symbol);
      filtered = filtered.filter(e => watchlistSymbols.includes(e.Symbol));
    }
    if (this.earningsSearchTerm) {
      const term = this.earningsSearchTerm.toUpperCase();
      filtered = filtered.filter(e => e.Symbol.includes(term));
    }
    return filtered;
  }

  getEarningsGroupedByDate(): { date: string; earnings: any[] }[] {
    const filtered = this.getFilteredEarnings();
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonth = this.earningsMonth.getMonth();
    const currentYear = this.earningsMonth.getFullYear();
    const groups: { [key: string]: any[] } = {};
    for (const e of filtered) {
      const dateKey = e.Date.split('T')[0];
      if (dateKey < todayStr) continue; // Skip past dates
      // Only show earnings for the currently selected month
      const [year, month] = dateKey.split('-').map(Number);
      if ((month - 1) !== currentMonth || year !== currentYear) continue;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(e);
    }
    return Object.keys(groups).sort().map(date => ({ date, earnings: groups[date] }));
  }

  isInWatchlist(symbol: string): boolean {
    return this.stocks.some(s => s.symbol === symbol);
  }

  isEarningsPast(dateStr: string): boolean {
    const todayStr = new Date().toISOString().split('T')[0];
    return dateStr.split('T')[0] < todayStr;
  }

  isEarningsToday(dateStr: string): boolean {
    const todayStr = new Date().toISOString().split('T')[0];
    return dateStr.split('T')[0] === todayStr;
  }

  quickAddFromEarnings(symbol: string): void {
    this.stockService.getStockBySymbol(symbol).subscribe({
      next: (data) => {
        this.stockService.addUserTrade(symbol, data.price).subscribe({
          next: (trade) => {
            this.stocks = [{
              symbol: trade.symbol,
              name: data.name || trade.symbol,
              price: data.price,
              buyPrice: trade.buy_price,
              targetPrice1: trade.target_price_1,
              targetPrice2: trade.target_price_2,
              targetPrice3: trade.target_price_3,
              stopLoss: trade.stop_loss_price,
              status: trade.status,
              change: data.change || 0,
              changePercent: data.changePercent || 0
            }, ...this.stocks];
            this.livePriceService.subscribe([trade.symbol]);
            this.cdr.detectChanges();
          },
          error: () => {}
        });
      },
      error: () => {}
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
    this.searchDetails = null;
    this.searchError = '';
  }

  getRecommendationTotal(rec: any): number {
    return (rec.strongBuy || 0) + (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0) + (rec.strongSell || 0);
  }

  loadMetricExplanations(): void {
    this.stockService.getMetricExplanations().subscribe({
      next: (data) => {
        this.metricExplanations = data;
      },
      error: () => {
        this.metricExplanations = [];
      }
    });
  }

  // Options helpers
  loadUserOptions(): void {
    this.loadingOptions = true;
    this.stockService.getUserOptionTrades().subscribe({
      next: (trades) => {
        this.userOptions = trades.map((t: any) => ({
          id: t.id,
          symbol: t.symbol,
          type: t.option_type,
          strike: parseFloat(t.strike),
          expiry: t.expiry.split('T')[0],
          premium: parseFloat(t.premium_paid),
          contracts: t.contracts,
          side: t.side || 'Buy',
          status: t.status
        }));
        this.loadingOptions = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.userOptions = [];
        this.loadingOptions = false;
        this.cdr.detectChanges();
      }
    });
  }

  getOptionPL(opt: any): number {
    return (0 - opt.premium) * opt.contracts * 100; // No live current premium yet, show cost basis
  }

  getOptionTotalCost(opt: any): number {
    return opt.premium * opt.contracts * 100;
  }

  getOptionsSummary(): { totalInvested: number; count: number } {
    let totalInvested = 0;
    for (const opt of this.userOptions) {
      totalInvested += this.getOptionTotalCost(opt);
    }
    return { totalInvested, count: this.userOptions.length };
  }

  getDaysToExpiry(expiry: string): number {
    const now = new Date();
    const exp = new Date(expiry + 'T00:00:00');
    return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  getExpiryStatus(expiry: string): string {
    const days = this.getDaysToExpiry(expiry);
    if (days < 0) return 'Expired';
    if (days <= 7) return 'This Week';
    if (days <= 14) return 'Next Week';
    return `${days}d`;
  }

  getExpiryClass(expiry: string): string {
    const days = this.getDaysToExpiry(expiry);
    if (days < 0) return 'expiry-expired';
    if (days <= 7) return 'expiry-urgent';
    if (days <= 14) return 'expiry-soon';
    return 'expiry-safe';
  }

  getSortedOptions(): any[] {
    let opts = [...this.userOptions];
    if (this.optionsSortColumn) {
      opts.sort((a, b) => {
        let valA: any, valB: any;
        switch (this.optionsSortColumn) {
          case 'symbol': valA = a.symbol; valB = b.symbol; break;
          case 'type': valA = a.type; valB = b.type; break;
          case 'strike': valA = a.strike; valB = b.strike; break;
          case 'expiry': valA = a.expiry; valB = b.expiry; break;
          case 'side': valA = a.side; valB = b.side; break;
          case 'premium': valA = a.premium; valB = b.premium; break;
          case 'contracts': valA = a.contracts; valB = b.contracts; break;
          case 'cost': valA = this.getOptionTotalCost(a); valB = this.getOptionTotalCost(b); break;
          default: return 0;
        }
        if (typeof valA === 'string') {
          const cmp = valA.localeCompare(valB);
          return this.optionsSortDirection === 'asc' ? cmp : -cmp;
        }
        return this.optionsSortDirection === 'asc' ? valA - valB : valB - valA;
      });
    }
    return opts;
  }

  toggleOptionsSort(column: string): void {
    if (this.optionsSortColumn === column) {
      this.optionsSortDirection = this.optionsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.optionsSortColumn = column;
      this.optionsSortDirection = 'asc';
    }
    this.cdr.detectChanges();
  }

  getOptionsSortIcon(column: string): string {
    if (this.optionsSortColumn !== column) return '⇅';
    return this.optionsSortDirection === 'asc' ? '↑' : '↓';
  }

  // Add Option flow
  openAddOptionForm(): void {
    this.showAddOptionForm = true;
    this.optionSearchTerm = '';
    this.optionSearchError = '';
    this.optionChainData = null;
    this.optionChainExpiries = [];
    this.selectedExpiry = '';
    this.optionChainOptions = [];
    this.newOption = { symbol: '', optionType: 'Call', strike: 0, expiry: '', premiumPaid: 0, contracts: 1, side: 'Buy' };
  }

  closeAddOptionForm(): void {
    this.showAddOptionForm = false;
    this.optionChainData = null;
  }

  searchOptionChain(): void {
    const symbol = this.optionSearchTerm.trim().toUpperCase();
    if (!symbol) return;
    this.optionSearching = true;
    this.optionSearchError = '';
    this.optionChainData = null;
    this.optionChainExpiries = [];
    this.selectedExpiry = '';
    this.optionChainOptions = [];

    this.stockService.getOptionsChain(symbol).subscribe({
      next: (data) => {
        this.optionSearching = false;
        if (!data || !data.data || data.data.length === 0) {
          this.optionSearchError = `No options data found for ${symbol}`;
          this.cdr.detectChanges();
          return;
        }
        this.optionChainData = data;
        this.newOption.symbol = symbol;
        // Extract unique expiry dates
        this.optionChainExpiries = data.data.map((d: any) => d.expirationDate).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).sort();
        if (this.optionChainExpiries.length > 0) {
          this.selectedExpiry = this.optionChainExpiries[0];
          this.filterOptionChainByExpiry();
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.optionSearching = false;
        this.optionSearchError = `Failed to fetch options for ${symbol}`;
        this.cdr.detectChanges();
      }
    });
  }

  filterOptionChainByExpiry(): void {
    if (!this.optionChainData || !this.selectedExpiry) {
      this.optionChainOptions = [];
      return;
    }
    const expiryData = this.optionChainData.data.find((d: any) => d.expirationDate === this.selectedExpiry);
    if (!expiryData || !expiryData.options) {
      this.optionChainOptions = [];
      return;
    }
    // Combine calls and puts into a flat list
    const calls = (expiryData.options.CALL || []).map((o: any) => ({ ...o, type: 'Call' }));
    const puts = (expiryData.options.PUT || []).map((o: any) => ({ ...o, type: 'Put' }));
    this.optionChainOptions = [...calls, ...puts].sort((a, b) => a.strike - b.strike);
    this.cdr.detectChanges();
  }

  onExpiryChange(): void {
    this.filterOptionChainByExpiry();
  }

  selectOptionFromChain(opt: any): void {
    this.newOption.symbol = this.optionSearchTerm.trim().toUpperCase();
    this.newOption.optionType = opt.type;
    this.newOption.strike = opt.strike;
    this.newOption.expiry = this.selectedExpiry;
    this.newOption.premiumPaid = opt.lastPrice || opt.ask || 0;
    this.cdr.detectChanges();
  }

  submitAddOption(): void {
    if (!this.newOption.symbol || !this.newOption.strike || !this.newOption.expiry || !this.newOption.premiumPaid) return;
    this.addingOption = true;
    this.stockService.addUserOptionTrade({
      symbol: this.newOption.symbol,
      optionType: this.newOption.optionType,
      strike: this.newOption.strike,
      expiry: this.newOption.expiry,
      premiumPaid: this.newOption.premiumPaid,
      contracts: this.newOption.contracts,
      side: this.newOption.side
    }).subscribe({
      next: (trade) => {
        this.userOptions = [{
          id: trade.id,
          symbol: trade.symbol,
          type: trade.option_type,
          strike: parseFloat(trade.strike),
          expiry: trade.expiry.split('T')[0],
          premium: parseFloat(trade.premium_paid),
          contracts: trade.contracts,
          side: trade.side || 'Buy',
          status: trade.status
        }, ...this.userOptions];
        this.addingOption = false;
        this.closeAddOptionForm();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.addingOption = false;
        this.optionSearchError = err.error?.error || 'Failed to add option trade';
        this.cdr.detectChanges();
      }
    });
  }

  confirmDeleteOption(id: number): void {
    this.deleteOptionConfirmId = id;
  }

  cancelDeleteOption(): void {
    this.deleteOptionConfirmId = null;
  }

  deleteOption(id: number): void {
    this.deleteOptionConfirmId = null;
    this.stockService.deleteUserOptionTrade(id).subscribe({
      next: () => {
        this.userOptions = this.userOptions.filter(o => o.id !== id);
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Error deleting option:', err)
    });
  }

  loadMonthlyPL(): void {
    this.loadingMonthlyPL = true;
    this.stockService.getMonthlyPL().subscribe({
      next: (data) => {
        this.monthlyPL = data.totalPL || 0;
        this.monthlyPLDetails = data.details || [];
        this.loadingMonthlyPL = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.monthlyPL = 0;
        this.monthlyPLDetails = [];
        this.loadingMonthlyPL = false;
        this.cdr.detectChanges();
      }
    });
  }

  getMetricTooltip(metric: string, value: number | null): string {
    if (value === null || value === undefined) return '';
    const explanations = this.metricExplanations.filter(e => e.metric === metric);
    for (const exp of explanations) {
      const min = exp.min_value !== null ? parseFloat(exp.min_value) : -Infinity;
      const max = exp.max_value !== null ? parseFloat(exp.max_value) : Infinity;
      if (value >= min && value < max) {
        return `${exp.label}: ${exp.description}`;
      }
    }
    return '';
  }

  // Earnings analysis
  openEarningsAnalysis(symbol: string): void {
    this.showAnalysisPopup = true;
    this.loadingAnalysis = true;
    this.earningsAnalysis = null;
    this.analysisError = '';
    this.stockService.getEarningsAnalysis(symbol).subscribe({
      next: (data) => {
        this.earningsAnalysis = data;
        this.loadingAnalysis = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingAnalysis = false;
        this.analysisError = 'Failed to load earnings analysis. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  closeAnalysisPopup(): void {
    this.showAnalysisPopup = false;
    this.earningsAnalysis = null;
  }

  navigateToStock(symbol: string): void {
    this.router.navigate(['/stock', symbol]);
  }

  getAnalysisRecommendationTotal(): number {
    const rec = this.earningsAnalysis?.recommendation;
    if (!rec) return 0;
    return (rec.strongBuy || 0) + (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0) + (rec.strongSell || 0);
  }
}
