import { authService } from './authService';

const API_BASE_URL = import.meta.env.VITE_API_URL;

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = authService.getToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    authService.logout();
    window.location.href = '/login';
  }

  return response;
}

export async function fetchData(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  return fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
  });
}

export async function downloadFile(url: string): Promise<Blob> {
  const token = authService.getToken();
  
  const headers: HeadersInit = {
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'GET',
    headers,
  });

  if (response.status === 401) {
    authService.logout();
    window.location.href = '/login';
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
}