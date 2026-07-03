import { prisma } from '../config/database';
import { RequestStatus } from '@prisma/client';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../utils/ApiError';
import { emitToUser } from '../socket/socketServer';
import { createNotification } from './notification.service';

const CLOSED_STATUSES: RequestStatus[] = [
  RequestStatus.CANCELLED,
  RequestStatus.EXPIRED,
  RequestStatus.FULFILLED,
];

// ── 0. Create or get bank conversation ────────────────────────────────────────
// Uses raw SQL so this works even when the Prisma client was generated before
// requestId became nullable and before bankId/bankName columns were added.
// Requires migration 20260629000000_add_bank_conversations to be applied first.

export async function createOrGetBankConversation(
  bankId: string,
  userId: string
): Promise<{ conversationId: string; created: boolean; bankName: string }> {
  console.log('[BankMessage] pressed bankId:', bankId);

  const bank = await prisma.bloodBank.findUnique({
    where: { id: bankId },
    select: { name: true, ownerId: true },
  });
  if (!bank) throw new NotFoundError('Blood bank not found');
  if (!bank.ownerId) throw new BadRequestError('This blood bank is not yet managed in BloodLink');

  const ownerId = bank.ownerId;
  console.log('[BankMessage] ownerId:', ownerId);
  // requestId IS NULL is the safe discriminator — donor conversations always have a non-null requestId
  console.log('[BankMessage] using schema fields: requesterId, donorId, requestId=null');

  // Raw query — Prisma client predates nullable requestId and bankId/bankName columns
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Conversation"
    WHERE  "requesterId" = ${userId}
    AND    "donorId"     = ${ownerId}
    AND    "requestId"   IS NULL
    LIMIT  1
  `;

  const existing = rows[0] ?? null;
  console.log('[BankMessage] existing conversation:', existing?.id ?? 'none');

  if (existing) {
    console.log('[BankMessage] returning conversationId:', existing.id);
    return { conversationId: existing.id, created: false, bankName: bank.name };
  }

  const newId = crypto.randomUUID();
  // bankName stored for inbox display; bankId stored for future index queries
  await prisma.$executeRaw`
    INSERT INTO "Conversation" (id, "requesterId", "donorId", "bankId", "bankName", "createdAt", "updatedAt")
    VALUES (${newId}, ${userId}, ${ownerId}, ${bankId}, ${bank.name}, NOW(), NOW())
  `;

  console.log('[BankMessage] created conversation:', newId);
  console.log('[BankMessage] returning conversationId:', newId);

  return { conversationId: newId, created: true, bankName: bank.name };
}

// ── 0b. Create or get request-specific bank conversation ──────────────────────
// Used when a user opens chat from a specific bank blood request (not "Message
// this Bank"). Conversation carries the BloodRequest ID as requestId, so
// getConversationDetail can read the request status for chat-lock.

export async function createOrGetBankRequestConversation(
  requestId: string,
  userId: string
): Promise<{ conversationId: string; created: boolean; bankName: string; requestStatus: string }> {
  console.log('[BankChatLink] creating/getting conversation for requestId:', requestId);

  const bloodRequest = await prisma.bloodRequest.findUnique({
    where:  { id: requestId },
    select: { requesterId: true, bloodBankId: true, status: true },
  });
  if (!bloodRequest) throw new NotFoundError('Blood request not found');
  if (!bloodRequest.bloodBankId) throw new BadRequestError('This is not a bank request');
  if (bloodRequest.requesterId !== userId) throw new ForbiddenError('Not your request');

  const bank = await prisma.bloodBank.findUnique({
    where:  { id: bloodRequest.bloodBankId },
    select: { name: true, ownerId: true },
  });
  if (!bank) throw new NotFoundError('Blood bank not found');
  if (!bank.ownerId) throw new BadRequestError('This blood bank is not yet managed in BloodLink');

  const ownerId = bank.ownerId;
  console.log('[BankChatLink] bankOwnerId:', ownerId);
  console.log('[BankChatLink] requestStatus:', bloodRequest.status);

  // Unique by (requestId, donorId=ownerId) — safe with old Prisma client because
  // requestId is non-null here and select: { id: true } avoids mapping all scalars.
  const existing = await prisma.conversation.findUnique({
    where:  { requestId_donorId: { requestId, donorId: ownerId } },
    select: { id: true },
  });

  if (existing) {
    console.log('[BankChatLink] existing conversation:', existing.id);
    console.log('[BankChatLink] linked requestId to conversation:', requestId);
    return { conversationId: existing.id, created: false, bankName: bank.name, requestStatus: bloodRequest.status };
  }

  const newId = crypto.randomUUID();
  await prisma.conversation.create({
    data:   { id: newId, requestId, requesterId: userId, donorId: ownerId, bankId: bloodRequest.bloodBankId, bankName: bank.name },
    select: { id: true },
  });

  console.log('[BankChatLink] created conversation:', newId);
  console.log('[BankChatLink] linked requestId to conversation:', requestId);
  return { conversationId: newId, created: true, bankName: bank.name, requestStatus: bloodRequest.status };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationListItem {
  conversationId: string;
  requestId: string | null;
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
  requestId: string | null;
  hospitalName: string;
  bloodGroup: string;
  units: number;
  requesterName: string;
  donorName: string;
  requestStatus: string;
  isClosed: boolean;
  messages: MessageItem[];
}

// ── 1. Create or get conversation ─────────────────────────────────────────────

export async function createOrGetConversation(
  requestId: string,
  requesterId: string,
  donorId: string
): Promise<{ conversationId: string; created: boolean }> {
  const existing = await prisma.conversation.findUnique({
    where: { requestId_donorId: { requestId, donorId } },
    select: { id: true },
  });

  if (existing) {
    return { conversationId: existing.id, created: false };
  }

  const conv = await prisma.conversation.create({
    data: { id: crypto.randomUUID(), requestId, requesterId, donorId },
    select: { id: true },
  });

  console.log(
    `[Conversation] created requestId: ${requestId} donorId: ${donorId} conversationId: ${conv.id}`
  );
  return { conversationId: conv.id, created: true };
}

// ── 2. List conversations for a user ──────────────────────────────────────────

export async function getConversations(userId: string): Promise<ConversationListItem[]> {
  // Raw SQL — Prisma ORM crashes when it deserialises a Conversation row with
  // requestId = NULL because the generated client was built from a schema that
  // had requestId as String (non-nullable). LEFT JOIN keeps bank conversations.
  const convRows = await prisma.$queryRaw<Array<{
    id: string;
    requestId: string | null;
    requesterId: string;
    donorId: string;
    bankId: string | null;
    bankName: string | null;
    lastMessageAt: Date | null;
    createdAt: Date;
    requesterName: string;
    donorName: string;
    bloodGroup: string | null;
    hospitalName: string | null;
    requestStatus: string | null;
  }>>`
    SELECT
      c.id,
      c."requestId",
      c."requesterId",
      c."donorId",
      c."bankId",
      c."bankName",
      c."lastMessageAt",
      c."createdAt",
      u_req.name  AS "requesterName",
      u_don.name  AS "donorName",
      br."bloodGroup",
      br."hospitalName",
      br.status   AS "requestStatus"
    FROM "Conversation" c
    JOIN  "User"         u_req ON u_req.id = c."requesterId"
    JOIN  "User"         u_don ON u_don.id = c."donorId"
    LEFT JOIN "BloodRequest" br  ON br.id  = c."requestId"
    WHERE c."requesterId" = ${userId} OR c."donorId" = ${userId}
    ORDER BY COALESCE(c."lastMessageAt", c."createdAt") DESC
  `;

  if (convRows.length === 0) return [];

  const [lastMessages, unreadCounts] = await Promise.all([
    Promise.all(
      convRows.map((c) =>
        prisma.message.findFirst({
          where:   { conversationId: c.id },
          orderBy: { createdAt: 'desc' },
          select:  { body: true, createdAt: true },
        })
      )
    ),
    Promise.all(
      convRows.map((c) =>
        prisma.message.count({
          where: { conversationId: c.id, senderId: { not: userId }, readAt: null },
        })
      )
    ),
  ]);

  console.log(`[MessagesUI] conversations count: ${convRows.length}`);
  console.log(`[MessagesUI] bank conversation count: ${convRows.filter(c => !c.requestId).length}`);

  return convRows.map((c, i) => ({
    conversationId: c.id,
    requestId:      c.requestId ?? null,
    hospitalName:   c.bankName ?? c.hospitalName ?? 'Direct Message',
    bloodGroup:     c.bloodGroup ?? '',
    requesterName:  c.requesterName,
    donorName:      c.donorName,
    lastMessage:    lastMessages[i]?.body ?? null,
    lastMessageAt:  lastMessages[i]?.createdAt.toISOString() ?? null,
    unreadCount:    unreadCounts[i],
    requestStatus:  c.requestStatus ?? 'ACTIVE',
    myRole:         c.requesterId === userId ? 'requester' : 'donor',
    bankId:         c.bankId ?? undefined,
  }));
}

// ── 3. Get conversation detail + messages ─────────────────────────────────────

export async function getConversationDetail(
  conversationId: string,
  userId: string
): Promise<ConversationDetail> {
  // Raw SQL — Prisma ORM crashes when deserialising requestId = NULL (bank
  // conversations) because the generated client has requestId typed as String
  // (non-nullable). $queryRaw bypasses the type mapper entirely.
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    requestId: string | null;
    requesterId: string;
    donorId: string;
    bankId: string | null;
    bankName: string | null;
  }>>`
    SELECT id, "requestId", "requesterId", "donorId", "bankId", "bankName"
    FROM "Conversation"
    WHERE id = ${conversationId}
    LIMIT 1
  `;

  const conv = rows[0] ?? null;
  if (!conv) throw new NotFoundError('Conversation not found');
  if (conv.requesterId !== userId && conv.donorId !== userId) {
    throw new ForbiddenError('You do not have access to this conversation');
  }

  const isBank = !conv.requestId;
  console.log('[MessageRead] conversationId:', conversationId);
  console.log('[MessageRead] requestId:', conv.requestId ?? 'null');
  console.log('[MessageRead] conversationType:', isBank ? 'BANK_OR_DIRECT' : 'REQUEST');

  // Fetch request only when requestId is non-null (skip for bank conversations)
  let request: { bloodGroup: string; hospitalName: string; status: string; units: number } | null = null;
  if (conv.requestId) {
    request = await prisma.bloodRequest.findUnique({
      where:  { id: conv.requestId },
      select: { bloodGroup: true, hospitalName: true, status: true, units: true },
    });
  }

  const requestStatus = request?.status ?? 'ACTIVE';
  const isClosed      = CLOSED_STATUSES.includes(requestStatus as RequestStatus);
  console.log('[ChatLock] requestStatus:', requestStatus);
  console.log('[ChatLock] isClosed:', isClosed);

  // Fetch participants and messages via ORM — Message/User tables are unaffected
  const [requesterUser, donorUser, msgs] = await Promise.all([
    prisma.user.findUnique({ where: { id: conv.requesterId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: conv.donorId },     select: { name: true } }),
    prisma.message.findMany({
      where:   { conversationId },
      orderBy: { createdAt: 'asc' },
      select:  { id: true, senderId: true, body: true, createdAt: true, readAt: true },
    }),
  ]);

  // Mark messages from other party as read
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: userId }, readAt: null },
    data:  { readAt: new Date() },
  });

  console.log(`[MessagesUI] messages count: ${msgs.length}`);

  return {
    conversationId:  conv.id,
    requestId:       conv.requestId ?? null,
    hospitalName:    conv.bankName ?? request?.hospitalName ?? 'Direct Message',
    bloodGroup:      request?.bloodGroup ?? '',
    units:           request?.units ?? 0,
    requesterName:   requesterUser?.name ?? '',
    donorName:       donorUser?.name ?? '',
    requestStatus,
    isClosed,
    messages: msgs.map((m) => ({
      id:             m.id,
      conversationId,
      senderId:       m.senderId,
      body:           m.body,
      createdAt:      m.createdAt.toISOString(),
      readAt:         m.readAt?.toISOString() ?? null,
      isMine:         m.senderId === userId,
    })),
  };
}

// ── 4. Send a message ─────────────────────────────────────────────────────────

export async function sendMessage(
  conversationId: string,
  senderId: string,
  body: string
): Promise<MessageItem> {
  console.log('[MessageSend] conversationId:', conversationId);
  console.log('[MessageSend] senderId:', senderId);
  console.log('[MessageSend] body length:', body?.trim()?.length ?? 0);

  if (!body || body.trim().length === 0) {
    throw new BadRequestError('Message body is required');
  }
  if (body.trim().length > 1000) {
    throw new BadRequestError('Message body must be at most 1000 characters');
  }

  // Raw SQL — same issue as getConversationDetail: Prisma ORM tries to map
  // requestId as String (non-nullable) from the generated client, crashing when
  // the DB row has requestId = NULL (bank conversations).
  // conversation.update also uses RETURNING * and would crash the same way, so
  // we use $executeRaw for the lastMessageAt update below.
  const convRows = await prisma.$queryRaw<Array<{
    id: string;
    requestId: string | null;
    requesterId: string;
    donorId: string;
  }>>`
    SELECT id, "requestId", "requesterId", "donorId"
    FROM "Conversation"
    WHERE id = ${conversationId}
    LIMIT 1
  `;

  const conv = convRows[0] ?? null;
  if (!conv) throw new NotFoundError('Conversation not found');
  if (conv.requesterId !== senderId && conv.donorId !== senderId) {
    throw new ForbiddenError('You do not have access to this conversation');
  }

  const isBank = !conv.requestId;
  console.log('[MessageSend] requestId:', conv.requestId ?? 'null');
  console.log('[MessageSend] conversationType:', isBank ? 'BANK_OR_DIRECT' : 'REQUEST');

  // Enforce closed-status only for request-based conversations
  if (conv.requestId) {
    const relatedRequest = await prisma.bloodRequest.findUnique({
      where:  { id: conv.requestId },
      select: { status: true },
    });
    if (relatedRequest && CLOSED_STATUSES.includes(relatedRequest.status as RequestStatus)) {
      console.log('[ChatLock] send blocked:', relatedRequest.status);
      throw new ConflictError('Conversation is closed because the request is completed.');
    }
  }

  // Fetch participant names for notification (User table — no null requestId issue)
  const [requesterUser, donorUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: conv.requesterId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: conv.donorId },     select: { name: true } }),
  ]);

  const msg = await prisma.message.create({
    data: { id: crypto.randomUUID(), conversationId, senderId, body: body.trim() },
  });

  // $executeRaw avoids the ORM RETURNING * which would also crash on null requestId
  await prisma.$executeRaw`
    UPDATE "Conversation" SET "lastMessageAt" = ${msg.createdAt} WHERE id = ${conversationId}
  `;

  console.log('[MessageSend] created messageId:', msg.id);
  console.log(`[Message] sent conversationId: ${conversationId} senderId: ${senderId}`);

  const senderName  = conv.requesterId === senderId ? (requesterUser?.name ?? '') : (donorUser?.name ?? '');
  const recipientId = conv.requesterId === senderId ? conv.donorId                : conv.requesterId;

  const msgPayload = {
    id:             msg.id,
    conversationId,
    senderId,
    body:           msg.body,
    createdAt:      msg.createdAt.toISOString(),
    readAt:         null,
  };

  emitToUser(conv.requesterId, 'message:new',          msgPayload);
  emitToUser(conv.donorId,     'message:new',          msgPayload);
  emitToUser(conv.requesterId, 'conversations:updated', { conversationId });
  emitToUser(conv.donorId,     'conversations:updated', { conversationId });
  console.log(`[Socket] emitted message:new conversationId: ${conversationId}`);

  const shortBody = msg.body.length > 60 ? msg.body.slice(0, 57) + '...' : msg.body;
  createNotification(
    recipientId,
    'NEW_MESSAGE',
    'New message',
    `${senderName}: ${shortBody}`,
    { requestId: conv.requestId, conversationId }
  ).catch(() => {});

  return {
    id:             msg.id,
    conversationId,
    senderId,
    body:           msg.body,
    createdAt:      msg.createdAt.toISOString(),
    readAt:         null,
    isMine:         true,
  };
}
