export interface AppNotification {
  id: number;
  title: string;
  content: string;
  targetType: 'team' | 'user' | string;
  authorName: string | null;
  createdAt: string;
  isRead: boolean;
  readAt: string | null;
}

export interface PaginatedNotifications {
  notifications: AppNotification[];
  total: number;
  unreadCount: number;
}
