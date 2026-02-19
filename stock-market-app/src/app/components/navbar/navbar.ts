import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { StockService } from '../../services/stock.service';

@Component({
  selector: 'app-navbar',
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
})
export class Navbar implements OnInit {
  menuOpen = false;
  isAdminUser = false;
  isNativePlatform = false;

  constructor(private authService: AuthService, public themeService: ThemeService, private stockService: StockService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.isNativePlatform = !!(window as any).Capacitor?.isNativePlatform?.();
    if (!this.isNativePlatform && this.isAuthenticated) {
      this.stockService.checkAdmin().subscribe(res => {
        this.isAdminUser = res.isAdmin;
        this.cdr.detectChanges();
      });
    }
  }

  get showDevLink(): boolean {
    return this.isAdminUser && !this.isNativePlatform;
  }

  get isAuthenticated(): boolean {
    return this.authService.isAuthenticated();
  }

  get userName(): string {
    const user = this.authService.getCurrentUser();
    if (!user) return '';
    const first = user.firstName || '';
    const last = user.lastName || '';
    const name = (first + ' ' + last).trim();
    return name || user.email;
  }

  get userInitials(): string {
    const user = this.authService.getCurrentUser();
    if (!user) return '';
    const first = user.firstName?.[0] || '';
    const last = user.lastName?.[0] || '';
    if (first || last) return (first + last).toUpperCase();
    return user.email[0].toUpperCase();
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  logout(): void {
    this.authService.logout();
  }
}
