import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';
import type { PaginatedNotifications } from '../types/notification';

export const notificationService = {
  async list(page = 1, perPage = 20): Promise<PaginatedNotifications> {
    const response = await fetchWithAuth(
      `${API_ENDPOINTS.NOTIFICATION.LIST}?page=${page}&per_page=${perPage}`
    );
    if (!response.ok) throw new Error('Failed to load notifications');
    return response.json();
  },

  async unreadCount(): Promise<number> {
    const response = await fetchWithAuth(API_ENDPOINTS.NOTIFICATION.UNREAD_COUNT);
    if (!response.ok) throw new Error('Failed to load unread count');
    const data = await response.json();
    return data.unread_count ?? 0;
  },

  async markAsRead(id: number): Promise<void> {
    const response = await fetchWithAuth(API_ENDPOINTS.NOTIFICATION.READ(id), { method: 'POST' });
    if (!response.ok) throw new Error('Failed to mark notification as read');
  },

  async markAllAsRead(): Promise<void> {
    const response = await fetchWithAuth(API_ENDPOINTS.NOTIFICATION.READ_ALL, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to mark notifications as read');
  },
};
