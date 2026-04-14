import { API_ENDPOINTS } from '../config/endpoints';
import type { User, Team } from '../models/user.model';
import type { LoginCredentials, AuthResponse } from '../models/auth.model';
import type { RegisterContestantPayload, RegistrationMetadata } from '../models/registration.model';
import { API_BASE_URL } from './api';
class AuthService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'user_info';

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.LOGIN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Login failed');
    }

    const data: AuthResponse = await response.json();
    this.setToken(data.generatedToken);
    this.setUser(data.user);
    return data;
  }

  async getRegistrationMetadata(): Promise<RegistrationMetadata> {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.REGISTRATION_METADATA}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Unable to load registration metadata');
    }

    const data = await response.json();
    return data.data as RegistrationMetadata;
  }

  async registerContestant(payload: RegisterContestantPayload): Promise<void> {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.REGISTER}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Registration failed');
    }
  }

  async logout(): Promise<void> {
    const token = this.getToken();

    try {
      if (token) {
        await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.LOGOUT}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      console.error('Logout API failed:', error);
    } finally {
      this.clearSession();
    }
  }

  clearSession(): void {
    // Keep existing behavior: clear auth data from local storage.
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