import { Router } from 'express';
import * as requestController from '../controllers/request.controller';
import * as matchingController from '../controllers/matching.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { createRequestSchema } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', requestController.getRequests);
router.get('/feed', requestController.getFeed);
router.get('/mine', requestController.getMyRequests);
router.get('/my',   requestController.getMyRequests);   // Phase 4 alias
router.get('/nearby', requestController.getNearbyRequests);
router.post('/', validate(createRequestSchema), requestController.createRequest);

// Phase 4 Step 2: matching + donor response
router.get('/accepted',         matchingController.getMyAcceptedRequests); // must be before /:id
router.get('/targeted-for-me',  matchingController.getMyTargetedRequests); // targeted personal requests for this donor
router.get('/:id/matches',   matchingController.getMatches);
router.post('/:id/respond',  matchingController.respondToRequest);
router.get('/:id/responses', matchingController.getResponses);
router.post('/:id/proof',    matchingController.submitProof);

// Phase 4.3: request lifecycle
router.patch('/:id/cancel',  requestController.cancelRequest);
router.patch('/:id/fulfill', requestController.fulfillRequest);

router.get('/:id',    requestController.getRequestById);
router.delete('/:id', requestController.cancelRequest); // backward compat

export default router;
