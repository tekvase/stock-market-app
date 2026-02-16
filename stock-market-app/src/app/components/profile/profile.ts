import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  imports: [CommonModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile {
  user: any;

  constructor(private authService: AuthService) {
    this.user = this.authService.getCurrentUser();
  }

  get fullName(): string {
    const first = this.user?.firstName || '';
    const last = this.user?.lastName || '';
    return (first + ' ' + last).trim() || 'Not set';
  }

  get initials(): string {
    const first = this.user?.firstName?.[0] || '';
    const last = this.user?.lastName?.[0] || '';
    if (first || last) return (first + last).toUpperCase();
    return this.user?.email?.[0]?.toUpperCase() || '?';
  }

  get accessLabel(): string {
    const code = this.user?.accessCode;
    if (code === 10) return 'Full Access';
    if (code === 3) return 'Advanced';
    if (code === 2) return 'Standard';
    return 'Basic';
  }

  get subscriptionStatus(): string {
    if (!this.user?.subscriptionEnd) return 'No subscription';
    const end = new Date(this.user.subscriptionEnd);
    if (end > new Date()) return 'Active';
    return 'Expired';
  }

  get subscriptionEnd(): string {
    if (!this.user?.subscriptionEnd) return '-';
    const d = new Date(this.user.subscriptionEnd);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
}
