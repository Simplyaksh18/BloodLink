import apiClient from './apiClient';
import { ApiResponse } from '../types';

export interface ConversationListItem {
  conversationId: string;
  requestId: string;
  hospitalName: string;
  bloodGroup: string;
  requesterName: string;
  donorName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  requestStatus: string;
  myRole: 'requester' | 'donor';
}

export interface MessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  isMine: boolean;
}

export interface ConversationDetail {
  conversationId: string;
  requestId: string;
  hospitalName: string;
  bloodGroup: string;
  units: number;
  requesterName: string;
  donorName: string;
  requestStatus: string;
  isClosed: boolean;
  messages: MessageItem[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return formatTime(iso);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export const messageService = {
  async getConversations(): Promise<ApiResponse<ConversationListItem[]>> {
    const res = await apiClient.get('/messages/conversations');
    return res.data;
  },

  async getConversation(conversationId: string): Promise<ApiResponse<ConversationDetail>> {
    const res = await apiClient.get(`/messages/conversations/${conversationId}`);
    return res.data;
  },

  async sendMessage(conversationId: string, body: string): Promise<ApiResponse<MessageItem>> {
    const res = await apiClient.post(`/messages/conversations/${conversationId}/messages`, { body });
    return res.data;
  },

  async createOrGetBankConversation(bankId: string): Promise<ApiResponse<{ conversationId: string; created: boolean; bankName: string }>> {
    const res = await apiClient.post(`/messages/blood-bank/${bankId}/conversation`);
    return res.data;
  },

  async createOrGetBankRequestConversation(requestId: string): Promise<ApiResponse<{ conversationId: string; created: boolean; bankName: string; requestStatus: string }>> {
    const res = await apiClient.post(`/messages/bank-request/${requestId}/conversation`);
    return res.data;
  },

  formatTime,
  formatDate,
};
