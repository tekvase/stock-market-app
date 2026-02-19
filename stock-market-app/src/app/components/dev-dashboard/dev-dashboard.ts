import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StockService } from '../../services/stock.service';
import { interval, Subscription } from 'rxjs';

@Component({
  selector: 'app-dev-dashboard',
  imports: [CommonModule],
  templateUrl: './dev-dashboard.html',
  styleUrl: './dev-dashboard.css'
})
export class DevDashboard implements OnInit, OnDestroy {
  status: any = null;
  loading = true;
  error = '';
  triggerMessage = '';
  triggerIsError = false;
  private refreshSub?: Subscription;

  constructor(private stockService: StockService, private router: Router) {}

  ngOnInit(): void {
    // Check if running on native (Capacitor) — if so, redirect away
    if ((window as any).Capacitor?.isNativePlatform?.()) {
      this.router.navigate(['/']);
      return;
    }

    this.loadStatus();
    // Auto-refresh every 30 seconds
    this.refreshSub = interval(30000).subscribe(() => this.loadStatus());
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
  }

  loadStatus(): void {
    this.loading = true;
    this.error = '';
    this.stockService.getDevStatus().subscribe({
      next: (data) => {
        this.status = data;
        this.loading = false;
        this.error = '';
      },
      error: (err) => {
        console.error('Dev status error:', err);
        this.loading = false;
        if (err.status === 403) {
          this.error = 'Admin access required. Make sure ADMIN_EMAILS is configured on the server.';
        } else if (err.status === 500) {
          this.error = 'Server error — check backend logs.';
        } else if (err.status === 0) {
          this.error = 'Cannot reach server — CORS or network issue.';
        } else {
          this.error = `Failed to load status (${err.status || 'unknown'})`;
        }
      }
    });
  }

  triggerJob(job: string): void {
    this.triggerMessage = '';
    this.stockService.triggerJob(job).subscribe({
      next: (res) => {
        this.triggerMessage = res.message;
        this.triggerIsError = false;
        setTimeout(() => this.triggerMessage = '', 5000);
      },
      error: () => {
        this.triggerMessage = `Failed to trigger ${job}`;
        this.triggerIsError = true;
        setTimeout(() => this.triggerMessage = '', 5000);
      }
    });
  }

  formatDuration(ms: number | null): string {
    if (!ms) return '--';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  formatTime(iso: string | null): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  getStatusClass(status: string | null): string {
    if (!status) return '';
    if (status === 'success') return 'status-success';
    if (status === 'error') return 'status-error';
    return 'status-pending';
  }

  getApiClass(status: string): string {
    if (status === 'ok' || status === 'connected' || status === 'active') return 'api-ok';
    if (status === 'rate-limited') return 'api-warn';
    return 'api-error';
  }

  goBack(): void {
    this.router.navigate(['/']);
  }
}
