import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-navbar',
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
})
export class Navbar {
  menuOpen = false;

  constructor(private authService: AuthService, public themeService: ThemeService) {}

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
