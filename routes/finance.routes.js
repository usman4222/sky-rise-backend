import express from 'express';
const router = express.Router();

import financeController from '../controllers/finance.controller.js';
const {
  getPaymentMethods,
  submitDeposit,
  submitWithdrawal,
  addWithdrawalAccount,
  getWithdrawalAccounts,
  transferTeamBonus,
  getWallets,
  getLedgerHistory
} = financeController;

import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { financeRateLimiter, requestLockGuard } from '../middleware/security.js';

router.get('/payment-methods', firebaseProtect, getPaymentMethods);
router.post('/deposit', firebaseProtect, financeRateLimiter, requestLockGuard, submitDeposit);
router.post('/withdraw', firebaseProtect, financeRateLimiter, requestLockGuard, submitWithdrawal);
router.post('/withdrawal-accounts', firebaseProtect, addWithdrawalAccount);
router.get('/withdrawal-accounts', firebaseProtect, getWithdrawalAccounts);
router.post('/transfer-bonus', firebaseProtect, financeRateLimiter, requestLockGuard, transferTeamBonus);
router.get('/wallets', firebaseProtect, getWallets);
router.get('/history', firebaseProtect, getLedgerHistory);

export default router;