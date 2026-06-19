import express from 'express';
import {
  requestWithdrawal,
  getMyWithdrawals,
  getWithdrawalDetails,
  cancelWithdrawal
} from '../controllers/withdrawal_request.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { financeRateLimiter, requestLockGuard } from '../middleware/security.js';

const router = express.Router();

router.use(firebaseProtect);

router.post('/request', financeRateLimiter, requestLockGuard, requestWithdrawal);
router.get('/my', getMyWithdrawals);
router.get('/:id', getWithdrawalDetails);
router.patch('/:id/cancel', financeRateLimiter, requestLockGuard, cancelWithdrawal);

export default router;
