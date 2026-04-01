import { authService } from './authService';

export const API_BASE_URL = window?.__ENV__?.VITE_API_URL || import.meta.env.VITE_API_URL;
export async function fetchWithAuth(url: string, options: RequestInit = {}, API = API_BASE_URL) {
  const token = authService.getToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API}${url}`, {
    ...options,
    headers,
  });

  // On 401, clear local session only (token is already invalid/expired).
  // Let components handle 403 (Forbidden - valid token but insufficient permissions).
  if (response.status === 401) {
    authService.clearSession();
    window.location.href = '/login';
  }

  return response;
}

export async function fetchData(url: string, options: RequestInit = {}, API = API_BASE_URL) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  return fetch(`${API}${url}`, {
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

  // On 401, clear local session only (token is already invalid/expired).
  if (response.status === 401) {
    authService.clearSession();
    window.location.href = '/login';
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
}