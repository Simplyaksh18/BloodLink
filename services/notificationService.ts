import apiClient from './apiClient';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  relatedRequestId?: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  data: AppNotification[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  unreadCount: number;
}

export const notificationService = {
  async getNotifications(page = 1, limit = 20): Promise<{ success: boolean; data: NotificationListResponse }> {
    const res = await apiClient.get(`/notifications?page=${page}&limit=${limit}`);
    return res.data;
  },

  async getUnreadCount(): Promise<{ success: boolean; data: { count: number } }> {
    const res = await apiClient.get('/notifications/unread-count');
    return res.data;
  },

  async markRead(notificationId: string): Promise<void> {
    await apiClient.patch(`/notifications/${notificationId}/read`);
  },

  async markAllRead(): Promise<void> {
    await apiClient.patch('/notifications/read-all');
  },
};
