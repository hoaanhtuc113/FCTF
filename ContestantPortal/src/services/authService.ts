import { API_ENDPOINTS } from '../config/endpoints';
import type { User, Team } from '../models/user.model';
import type { LoginCredentials, AuthResponse } from '../models/auth.model';

class AuthService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'user_info';

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await fetch(`${import.meta.env.VITE_API_URL}${API_ENDPOINTS.AUTH.LOGIN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    console.log('Login response status:', response);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Login failed');
    }

    const data: AuthResponse = await response.json();
    this.setToken(data.generatedToken);
    this.setUser(data.user);
    return data;
  }

  logout(): void {
    // Clear all localStorage data on logout
    localStorage.clear();
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  getUser(): User | null {
    const userStr = localStorage.getItem(this.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
  }

  setUser(user: User): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getTeam(): Team | null {
    const user = this.getUser();
    return user?.team || null;
  }
}

export const authService = new AuthService();