import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reset-password',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
})
export class ResetPassword implements OnInit {
  token = '';
  email = '';
  newPassword = '';
  confirmPassword = '';
  isLoading = false;
  isValidating = true;
  errorMessage = '';
  successMessage = '';
  tokenValid = false;
  resetComplete = false;

  private apiUrl = `${environment.apiUrl}/auth`;

  constructor(
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.token = params['token'] || '';
      if (this.token) {
        this.validateToken();
      } else {
        this.isValidating = false;
        this.errorMessage = 'No reset token provided. Please request a new password reset link.';
      }
    });
  }

  validateToken(): void {
    this.http.get<{ valid: boolean; email?: string }>(
      `${this.apiUrl}/validate-reset-token?token=${this.token}`
    ).subscribe({
      next: (response) => {
        this.isValidating = false;
        this.tokenValid = response.valid;
        this.email = response.email || '';
        if (!response.valid) {
          this.errorMessage = 'This reset link has expired or is invalid. Please request a new one.';
        }
      },
      error: () => {
        this.isValidating = false;
        this.errorMessage = 'Unable to validate reset link. Please try again.';
      }
    });
  }

  onSubmit(): void {
    this.errorMessage = '';

    if (!this.newPassword || !this.confirmPassword) {
      this.errorMessage = 'Please fill in both password fields';
      return;
    }

    if (this.newPassword.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters long';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match';
      return;
    }

    this.isLoading = true;

    this.http.post<{ message: string }>(`${this.apiUrl}/reset-password`, {
      token: this.token,
      newPassword: this.newPassword
    }).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.resetComplete = true;
        this.successMessage = response.message;
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.error || 'Failed to reset password. Please try again.';
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
