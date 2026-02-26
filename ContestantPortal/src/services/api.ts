import { authService } from './authService';

// export const API_BASE_URL = window?.__ENV__?.VITE_API_URL || import.meta.env.VITE_API_URL;
export const API_BASE_URL = 'https://api.fctf.site/contestant-be/api'; // Change this to your actual API base URL
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

  // Only logout on 401 (Unauthorized - invalid/expired token)
  // Let components handle 403 (Forbidden - valid token but insufficient permissions)
  if (response.status === 401) {
    authService.logout();
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

  // Only logout on 401 (Unauthorized - invalid/expired token)
  if (response.status === 401) {
    authService.logout();
    window.location.href = '/login';
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.blob();
}