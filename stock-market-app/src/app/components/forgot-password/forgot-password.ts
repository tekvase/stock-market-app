import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-forgot-password',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.css',
})
export class ForgotPassword {
  email = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  submitted = false;

  private apiUrl = `${environment.apiUrl}/auth`;

  constructor(private http: HttpClient) {}

  onSubmit(): void {
    if (!this.email) {
      this.errorMessage = 'Please enter your email address';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.http.post<{ message: string }>(`${this.apiUrl}/forgot-password`, {
      email: this.email
    }).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.submitted = true;
        this.successMessage = response.message;
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.error || 'Something went wrong. Please try again.';
      }
    });
  }
}
