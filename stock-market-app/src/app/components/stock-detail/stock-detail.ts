import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Stock, StockHistory } from '../../models/stock.model';
import { StockService } from '../../services/stock.service';

@Component({
  selector: 'app-stock-detail',
  imports: [CommonModule, RouterModule],
  templateUrl: './stock-detail.html',
  styleUrl: './stock-detail.css',
})
export class StockDetail implements OnInit {
  stock?: Stock;
  stockHistory: StockHistory[] = [];
  loading = true;
  symbol = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private stockService: StockService
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.symbol = params['symbol'];
      this.loadStockDetails();
    });
  }

  loadStockDetails(): void {
    this.loading = true;

    this.stockService.getStockBySymbol(this.symbol).subscribe({
      next: (data) => {
        this.stock = data;
        if (this.stock) {
          this.loadStockHistory();
        } else {
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error loading stock details:', error);
        this.loading = false;
      }
    });
  }

  loadStockHistory(): void {
    this.stockService.getStockHistory(this.symbol).subscribe({
      next: (data) => {
        this.stockHistory = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading stock history:', error);
        this.loading = false;
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
}
