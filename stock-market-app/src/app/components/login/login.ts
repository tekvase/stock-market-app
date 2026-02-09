import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  email = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  showSignupPrompt = false;
  showRetryPrompt = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    // If already logged in, redirect to dashboard
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  onSubmit(): void {
    // Reset prompts
    this.showSignupPrompt = false;
    this.showRetryPrompt = false;

    // Validation
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter email and password';
      return;
    }

    if (!this.isValidEmail(this.email)) {
      this.errorMessage = 'Please enter a valid email address (e.g., user@example.com)';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login(this.email, this.password).subscribe({
      next: (response) => {
        console.log('Login successful:', response);
        this.isLoading = false;
        // Navigate to dashboard
        this.router.navigate(['/']);
      },
      error: (error) => {
        console.error('Login error:', error);
        this.isLoading = false;

        const errorMsg = error.error?.error || 'Login failed';
        const errorCode = error.error?.code || '';

        if (errorCode === 'USER_NOT_FOUND' || error.status === 404) {
          this.errorMessage = errorMsg;
          this.showSignupPrompt = true;
          this.showRetryPrompt = false;
        } else if (errorCode === 'INVALID_PASSWORD' || error.status === 401) {
          this.errorMessage = errorMsg;
          this.showRetryPrompt = true;
          this.showSignupPrompt = false;
        } else {
          this.errorMessage = errorMsg;
        }

        this.cdr.detectChanges();
      }
    });
  }

  goToSignup(): void {
    this.router.navigate(['/signup'], {
      queryParams: { email: this.email }
    });
  }
}
