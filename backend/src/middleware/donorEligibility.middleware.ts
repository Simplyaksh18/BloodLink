import { Request, Response, NextFunction } from 'express';
import { getDonorStatus } from '../services/donorStatus.service';

/**
 * Blocks requests from users who are not active blood donors.
 * Apply to any route that requires the user to be a registered, eligible donor.
 */
export async function requireDonorEligibility(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ success: false, data: {}, message: 'Authentication required.' });
    return;
  }

  try {
    const status = await getDonorStatus(userId);

    if (status.donorStatus === 'ACTIVE') {
      next();
      return;
    }

    if (status.donorStatus === 'DEFERRED') {
      res.status(403).json({
        success: false,
        data: {
          donorStatus:     status.donorStatus,
          nextEligibleDate: status.nextEligibleDate,
          daysRemaining:   status.daysRemaining,
        },
        message: `You are currently deferred. Eligible to donate in ${status.daysRemaining ?? '?'} days.`,
      });
      return;
    }

    if (status.donorStatus === 'INELIGIBLE') {
      res.status(403).json({
        success: false,
        data: {
          donorStatus:   status.donorStatus,
          deferralReason: status.deferralReason,
        },
        message: 'You are not eligible to donate blood at this time.',
      });
      return;
    }

    // NEVER_DONATED or PENDING_REVIEW
    res.status(403).json({
      success: false,
      data: { donorStatus: status.donorStatus },
      message: 'Please complete the donor registration process first.',
    });
  } catch {
    res.status(500).json({ success: false, data: {}, message: 'Could not verify donor eligibility.' });
  }
}
