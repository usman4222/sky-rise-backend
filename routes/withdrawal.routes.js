import express from 'express';
import {
  requestWithdrawal,
  getMyWithdrawals,
  getWithdrawalDetails,
  cancelWithdrawal
} from '../controllers/withdrawal_request.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

router.use(firebaseProtect);

router.post('/request', requestWithdrawal);
router.get('/my', getMyWithdrawals);
router.get('/:id', getWithdrawalDetails);
router.patch('/:id/cancel', cancelWithdrawal);

export default router;
