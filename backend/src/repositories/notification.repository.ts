import { prisma } from '../config/database';
import { Notification } from '@prisma/client';

export class NotificationRepository {
  async create(data: {
    userId: string;
    title: string;
    body: string;
    notificationType: string;
    relatedRequestId?: string;
    data?: Record<string, unknown>;
  }): Promise<Notification> {
    return prisma.notification.create({
      data: {
        ...data,
        data: data.data ? JSON.stringify(data.data) : undefined,
      },
    });
  }

  async findByUserId(userId: string, page: number, limit: number): Promise<{ items: Notification[]; total: number; unread: number }> {
    const skip = (page - 1) * limit;
    const [items, total, unread] = await prisma.$transaction([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { items, total, unread };
  }

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  }

  async delete(id: string, userId: string): Promise<void> {
    await prisma.notification.deleteMany({ where: { id, userId } });
  }
}

export const notificationRepository = new NotificationRepository();
