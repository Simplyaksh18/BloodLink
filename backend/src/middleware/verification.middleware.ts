import { Request, Response, NextFunction } from 'express';
import { VerificationType, VerificationStatus } from '@prisma/client';
import { verificationRepository } from '../repositories/verification.repository';
import { ForbiddenError } from '../utils/ApiError';

export function verifyDocument(type: VerificationType) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        next(new ForbiddenError('Authentication required'));
        return;
      }

      const verification = await verificationRepository.findByUserAndType(userId, type);
      if (!verification || verification.status !== VerificationStatus.VERIFIED) {
        next(new ForbiddenError(`${type.replace(/_/g, ' ')} verification required to perform this action`));
        return;
      }

      if (verification.isExpired) {
        next(new ForbiddenError(`Your ${type.replace(/_/g, ' ')} verification has expired. Please renew.`));
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
