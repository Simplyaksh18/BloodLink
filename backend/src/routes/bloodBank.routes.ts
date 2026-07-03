import { Router } from 'express';
import * as bloodBankController from '../controllers/bloodBank.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { bloodBankRequestSchema } from '../utils/validators';

const router = Router();

// ─── IMPORTANT: all literal-path routes MUST come before /:id ─────────────────

// Public
router.get('/nearby', bloodBankController.getNearbyBanks);
router.get('/unowned', authenticate, bloodBankController.getUnownedBanks);

// Owner — bank profile
router.post('/', authenticate, bloodBankController.createBank);
router.get('/me', authenticate, bloodBankController.getMyBank);
router.get('/me/all', authenticate, bloodBankController.getMyBanks);       // multi-bank dashboard
router.patch('/me', authenticate, bloodBankController.updateMyBank);

// Owner — inventory
router.get('/me/inventory', authenticate, bloodBankController.getMyInventory);
router.post('/me/inventory', authenticate, bloodBankController.addInventoryItem);
router.patch('/me/inventory/:inventoryId', authenticate, bloodBankController.updateInventoryItem);
router.delete('/me/inventory/:inventoryId', authenticate, bloodBankController.deleteInventoryItem);

// Owner — incoming blood requests
router.get('/me/requests', authenticate, bloodBankController.getMyBankRequests);
router.patch('/me/requests/:requestId/accept', authenticate, bloodBankController.acceptBankRequest);
router.patch('/me/requests/:requestId/reject', authenticate, bloodBankController.rejectBankRequest);
router.patch('/me/requests/:requestId/complete', authenticate, bloodBankController.completeBankRequest);

// Public — list + detail (after all /me* routes)
router.get('/', bloodBankController.getAllBanks);
// optionalAuthenticate: populates req.user when a token is sent, so the owner
// of a not-yet-VERIFIED bank sees their own record instead of a spurious 404.
router.get('/:id', optionalAuthenticate, bloodBankController.getBankById);
router.get('/:id/inventory', bloodBankController.getPublicInventory);

// Authenticated — request blood from specific bank
router.post('/:id/request-blood', authenticate, validate(bloodBankRequestSchema), bloodBankController.requestBloodFromBank);

// Owner-link + dev-only (parameterised suffix — safe after literal /me routes)
router.patch('/:id/link-owner', authenticate, bloodBankController.linkBankOwner);
router.patch('/:id/dev-verify', bloodBankController.devVerify);

export default router;
