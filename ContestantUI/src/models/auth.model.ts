import type { User } from './user.model';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  generatedToken: string;
  user: User;
}