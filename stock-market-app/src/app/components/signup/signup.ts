import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup implements OnInit {
  firstName = '';
  lastName = '';
  email = '';
  password = '';
  confirmPassword = '';
  accessCode = 10; // Default: Full access (maps to Access table)
  errorMessage = '';
  isLoading = false;
  showLoginPrompt = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    // If already logged in, redirect to dashboard
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }

  ngOnInit(): void {
    // Get email from query params if redirected from login
    this.route.queryParams.subscribe(params => {
      if (params['email']) {
        this.email = params['email'];
      }
    });
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  onSubmit(): void {
    // Reset prompts
    this.showLoginPrompt = false;

    // Validation
    if (!this.email || !this.password || !this.confirmPassword) {
      this.errorMessage = 'Please fill in all fields';
      return;
    }

    if (!this.isValidEmail(this.email)) {
      this.errorMessage = 'Please enter a valid email address (e.g., user@example.com)';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match';
      return;
    }

    if (this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters long';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.register(this.email, this.password, this.accessCode, this.firstName, this.lastName).subscribe({
      next: (response) => {
        console.log('Registration successful:', response);
        this.isLoading = false;
        // Navigate to dashboard
        this.router.navigate(['/']);
      },
      error: (error) => {
        console.error('Registration error:', error);
        this.isLoading = false;

        const errorMsg = error.error?.error || 'Registration failed';

        // Check if user already exists
        if (errorMsg.toLowerCase().includes('already exists') ||
            errorMsg.toLowerCase().includes('duplicate') ||
            error.status === 400) {
          this.errorMessage = errorMsg;
          this.showLoginPrompt = true;
        } else {
          this.errorMessage = errorMsg + '. Please try again.';
        }
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login'], {
      queryParams: { email: this.email }
    });
  }
}
