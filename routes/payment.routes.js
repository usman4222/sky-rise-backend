import express from 'express';
import paymentController from '../controllers/payment.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

const {
  createPkrDeposit,
  handlePayfastCallback,
  getPkrDepositStatus,
  createUsdtDeposit,
  getUsdtDepositStatus,
  withdrawPkr,
  withdrawUsdt,
  getMyWithdrawals,
  getMyDeposits
} = paymentController;

// ===============================
// PKR Deposit (PayFast)
// ===============================
router.post('/pkr/deposit/create', firebaseProtect, createPkrDeposit);
router.post('/pkr/deposit/callback', handlePayfastCallback); // Public — verified via PayFast signature
router.get('/pkr/deposit/status/:depositId', firebaseProtect, getPkrDepositStatus);

// ===============================
// USDT Deposit (CoinPayments)
// ===============================
router.post('/usdt/deposit/create', firebaseProtect, createUsdtDeposit);
router.get('/usdt/deposit/status/:depositId', firebaseProtect, getUsdtDepositStatus);

// ===============================
// PKR Payout (Automatic)
// ===============================
router.post('/pkr/withdraw', firebaseProtect, withdrawPkr);

// ===============================
// USDT Payout (Automatic)
// ===============================
router.post('/usdt/withdraw', firebaseProtect, withdrawUsdt);

// ===============================
// Shared: User history
// ===============================
router.get('/withdrawals/my', firebaseProtect, getMyWithdrawals);
router.get('/deposits/my', firebaseProtect, getMyDeposits);

export default router;
