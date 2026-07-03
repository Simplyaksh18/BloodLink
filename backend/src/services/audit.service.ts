// Audit logging service — fire-and-forget, never blocks the request.
// Writes to AuditLog table. All metadata is sanitized before insert.

import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { sanitizeBody } from '../utils/piiSanitizer';

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'REGISTER'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_COMPLETE'
  | 'DONOR_REQUEST_CREATED'
  | 'TARGETED_REQUEST_CREATED'
  | 'PROFILE_UPDATE'
  | 'BLOOD_BANK_VERIFICATION_REVIEW';

interface AuditParams {
  userId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export function logAudit(params: AuditParams): void {
  const sanitized = params.metadata
    ? (sanitizeBody(params.metadata) as Prisma.InputJsonValue)
    : undefined;

  prisma.auditLog
    .create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        ip: params.ip ?? null,
        userAgent: (params.userAgent ?? '').slice(0, 500) || null,
        metadata: sanitized,
      },
    })
    .then(() => {
      console.log(
        '[Audit] event:', params.action,
        params.userId ? `| userId:${params.userId}` : '',
      );
    })
    .catch((err: unknown) => {
      console.log('[Audit] failed:', params.action, (err as Error)?.message ?? err);
    });
}

export function auditFromRequest(
  req: Request,
  action: AuditAction,
  extra?: Partial<AuditParams>,
): void {
  logAudit({
    userId: req.user?.userId ?? null,
    action,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'],
    ...extra,
  });
}
