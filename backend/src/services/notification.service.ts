import { notificationRepository } from '../repositories/notification.repository';
import { sendPushNotification } from '../config/firebase';
import { prisma } from '../config/database';
import { DonorResponseStatus } from '@prisma/client';
import { emitToUser } from '../socket/socketServer';
import { sendPushToUser } from './push.service';

// ── Low-level helpers ─────────────────────────────────────────────────────────

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const notification = await notificationRepository.create({
    userId,
    title,
    body,
    notificationType: type,
    relatedRequestId: (data?.requestId as string) ?? undefined,
    data,
  });
  console.log(`[Notification] created — id: ${notification.id} | type: ${type} | userId: ${userId}`);

  // Real-time: push to the user's socket room (fire-and-forget, must not break DB write)
  try {
    emitToUser(userId, 'notification:new', {
      id: notification.id,
      title,
      body,
      type,
      relatedRequestId: (data?.requestId as string) ?? undefined,
      isRead: false,
      createdAt: notification.createdAt.toISOString(),
    });
    const unreadCount = await notificationRepository.countUnread(userId);
    emitToUser(userId, 'notification:unread-count', { unreadCount });
  } catch {
    // socket emit must never break notification flow
  }

  // Push notification — fire-and-forget, never blocks in-app or socket flow
  sendPushToUser(userId, title, body, {
    type,
    ...(data?.requestId    ? { requestId:    String(data.requestId)    } : {}),
    ...(data?.bloodBankId  ? { bloodBankId:  String(data.bloodBankId)  } : {}),
    ...(data?.conversationId ? { conversationId: String(data.conversationId) } : {}),
  }).catch(() => {});
}

export async function createBulkNotifications(
  userIds: string[],
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;
  for (const userId of userIds) {
    await createNotification(userId, type, title, body, data);
  }
  console.log(`[Notification] bulk created count: ${userIds.length} | type: ${type}`);
}

// ── Push + persist (existing, keep for backward compat) ───────────────────────

export async function createAndSendNotification(data: {
  userId: string;
  title: string;
  body: string;
  notificationType: string;
  relatedRequestId?: string;
  extraData?: Record<string, unknown>;
}): Promise<void> {
  const notification = await notificationRepository.create({
    userId: data.userId,
    title: data.title,
    body: data.body,
    notificationType: data.notificationType,
    relatedRequestId: data.relatedRequestId,
    data: data.extraData,
  });

  const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { deviceToken: true } });
  if (user?.deviceToken) {
    const sent = await sendPushNotification(user.deviceToken, data.title, data.body, {
      notificationId: notification.id,
      type: data.notificationType,
      ...(data.relatedRequestId && { requestId: data.relatedRequestId }),
    });
    if (sent) {
      await prisma.notification.update({ where: { id: notification.id }, data: { isPushSent: true } });
    }
  }
}

// ── Read APIs ────────────────────────────────────────────────────────────────

export async function getUserNotifications(userId: string, page: number, limit: number) {
  const { items, total, unread } = await notificationRepository.findByUserId(userId, page, limit);
  return {
    data: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.notificationType,
      relatedRequestId: n.relatedRequestId ?? undefined,
      data: (n.data as Record<string, unknown> | null) ?? undefined,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
    hasMore: page * limit < total,
    unreadCount: unread,
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const count = await notificationRepository.countUnread(userId);
  console.log(`[Notification] unread count: ${count} | userId: ${userId}`);
  return count;
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
  await notificationRepository.markRead(notificationId, userId);
}

export async function markAllRead(userId: string): Promise<void> {
  await notificationRepository.markAllRead(userId);
}

export async function deleteNotification(notificationId: string, userId: string): Promise<void> {
  await notificationRepository.delete(notificationId, userId);
}

// ── Event hooks (replace placeholders with real DB writes) ────────────────────

// Called from donorMatching.service after donor responds to a request.
// action is DonorResponseStatus enum value ('ACCEPTED' | 'DECLINED').
export async function queueRequestNotification(
  requestId: string,
  actorDonorId: string,
  action: string
): Promise<void> {
  console.log(
    `[NotificationPlaceholder] would notify matching donors — requestId: ${requestId}`,
    `| actor: ${actorDonorId} | action: ${action}`
  );

  // Only notify requester when a donor accepts; skip DECLINED (too noisy).
  if (action !== DonorResponseStatus.ACCEPTED) return;

  try {
    const request = await prisma.bloodRequest.findUnique({
      where: { id: requestId },
      select: { requesterId: true, bloodGroup: true, hospitalName: true },
    });
    if (!request) return;
    if (request.requesterId === actorDonorId) return; // never self-notify

    const donor = await prisma.user.findUnique({
      where: { id: actorDonorId },
      select: { name: true },
    });
    const donorName = donor?.name ?? 'A donor';

    await createNotification(
      request.requesterId,
      'DONOR_ACCEPTED',
      'Donor accepted your request',
      `${donorName} accepted your ${request.bloodGroup} blood request at ${request.hospitalName}`,
      { requestId, donorId: actorDonorId }
    );
  } catch (err) {
    console.log('[Notification] queueRequestNotification error:', err);
  }
}

// Called from request.service after status changes (CANCELLED, FULFILLED, EXPIRED).
export async function queueLifecycleNotification(
  requestId: string,
  newStatus: string,
  actorId: string
): Promise<void> {
  console.log(
    `[NotificationPlaceholder] request lifecycle event — requestId: ${requestId}`,
    `| status: ${newStatus} | actor: ${actorId}`
  );

  try {
    const request = await prisma.bloodRequest.findUnique({
      where: { id: requestId },
      select: { requesterId: true, bloodGroup: true, hospitalName: true },
    });
    if (!request) return;

    const acceptedRows = await prisma.donorRequestResponse.findMany({
      where: { requestId, response: DonorResponseStatus.ACCEPTED },
      select: { donorId: true },
    });
    const donorIds = acceptedRows.map((r) => r.donorId);

    if (newStatus === 'CANCELLED') {
      if (donorIds.length > 0) {
        await createBulkNotifications(
          donorIds,
          'REQUEST_CANCELLED',
          'Request cancelled',
          `A ${request.bloodGroup} blood request you responded to was cancelled`,
          { requestId }
        );
      }

    } else if (newStatus === 'FULFILLED') {
      if (donorIds.length > 0) {
        await createBulkNotifications(
          donorIds,
          'REQUEST_FULFILLED',
          'Request fulfilled',
          'The blood request has been marked complete. Thank you for your help!',
          { requestId }
        );
      }

    } else if (newStatus === 'EXPIRED') {
      // Notify requester
      await createNotification(
        request.requesterId,
        'REQUEST_EXPIRED',
        'Your request has expired',
        `Your ${request.bloodGroup} blood request at ${request.hospitalName} has expired`,
        { requestId }
      );
      // Notify donors who accepted
      if (donorIds.length > 0) {
        await createBulkNotifications(
          donorIds,
          'REQUEST_EXPIRED',
          'Request expired',
          `A ${request.bloodGroup} blood request you responded to has expired`,
          { requestId }
        );
      }
    }

    // Real-time: emit request:updated to requester + all accepted donors
    const allAffectedIds = Array.from(new Set([request.requesterId, ...donorIds]));
    for (const uid of allAffectedIds) {
      emitToUser(uid, 'request:updated', { requestId, status: newStatus });
    }
  } catch (err) {
    console.log('[Notification] queueLifecycleNotification error:', err);
  }
}
