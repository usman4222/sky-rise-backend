import express from 'express';
import adminController from '../controllers/admin.controller.js';
import adminPaymentController from '../controllers/adminPayment.controller.js';
import {
  listWeeklySalaryRequests,
  getWeeklySalaryRequest,
  approveWeeklySalaryRequest,
  rejectWeeklySalaryRequest,
  listWithdrawalRequests,
  getWithdrawalRequest,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  markPaidWithdrawalRequest,
  adjustUserBalance,
  getAdminBalanceHistory,
  getUserFavorDetails,
  updateUserFavorSettings
} from '../controllers/admin_actions.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { restrictTo } from '../middleware/rbac.js';
import { adminRateLimiter } from '../middleware/security.js';

const router = express.Router();

const {
  processDeposit,
  processWithdrawal,
  processKyc,

  createPackage,
  getAdminPackages,
  updatePackage,

  createPaymentMethod,
  getAdminPaymentMethods,
  updatePaymentMethod,

  updateExchangeRate,
  getAdminDashboard
} = adminController;

// Firebase auth + ADMIN / SUPER_ADMIN role protection with admin rate limiting
const adminMiddleware = [
  firebaseProtect,
  restrictTo('ADMIN', 'SUPER_ADMIN'),
  adminRateLimiter
];

// ===============================
// Admin Dashboard
// ===============================
router.get('/dashboard', adminMiddleware, getAdminDashboard);

// ===============================
// Deposit Management (Legacy manual)
// ===============================
router.get('/deposits', adminMiddleware, adminController.getAdminDeposits);
router.post('/deposits/:id/action', adminMiddleware, processDeposit);

// ===============================
// Weekly Salary Management
// ===============================
router.get('/weekly-salary/requests', adminMiddleware, listWeeklySalaryRequests);
router.get('/weekly-salary/requests/:id', adminMiddleware, getWeeklySalaryRequest);
router.patch('/weekly-salary/requests/:id/approve', adminMiddleware, approveWeeklySalaryRequest);
router.patch('/weekly-salary/requests/:id/reject', adminMiddleware, rejectWeeklySalaryRequest);

// ===============================
// Withdrawal Request Management (New System)
// ===============================
router.get('/withdrawals', adminMiddleware, listWithdrawalRequests);
router.get('/withdrawals/:id', adminMiddleware, getWithdrawalRequest);
router.patch('/withdrawals/:id/approve', adminMiddleware, approveWithdrawalRequest);
router.patch('/withdrawals/:id/reject', adminMiddleware, rejectWithdrawalRequest);
router.patch('/withdrawals/:id/mark-paid', adminMiddleware, markPaidWithdrawalRequest);

// ===============================
// User Management
// ===============================
router.get('/users', adminMiddleware, adminController.listUsers);
router.get('/unverified-users', adminMiddleware, adminController.listUnverifiedUsers);
router.post('/unverified-users/cleanup', adminMiddleware, adminController.cleanupUnverifiedUsers);
router.get('/users/:id', adminMiddleware, adminController.getUserDetail);
router.post('/users/:id/suspend', adminMiddleware, adminController.suspendUser);
router.post('/users/:id/activate', adminMiddleware, adminController.activateUser);
router.post('/users/:id/balance/adjust', adminMiddleware, adjustUserBalance);
router.get('/users/:id/favor', adminMiddleware, getUserFavorDetails);
router.patch('/users/:id/favor', adminMiddleware, updateUserFavorSettings);
router.get('/balance/history', adminMiddleware, getAdminBalanceHistory);

// ===============================
// KYC Management
// ===============================
router.get('/kyc', adminMiddleware, adminController.getAdminKyc);
router.post('/kyc/:id/action', adminMiddleware, processKyc);

// ===============================
// Package Management
// ===============================

// Create single package
router.post('/packages', adminMiddleware, createPackage);

// Create multiple packages at once
router.post('/packages/bulk', adminMiddleware, createPackage);

// Get all packages for admin
router.get('/packages', adminMiddleware, getAdminPackages);

// Update package
router.put('/packages/:id', adminMiddleware, updatePackage);
router.patch('/packages/:id', adminMiddleware, updatePackage);

// ===============================
// Payment Method Management
// ===============================

// Create payment method
router.post('/payment-methods', adminMiddleware, createPaymentMethod);

// Get all payment methods for admin
router.get('/payment-methods', adminMiddleware, getAdminPaymentMethods);

// Update payment method
router.put('/payment-methods/:id', adminMiddleware, updatePaymentMethod);
router.patch('/payment-methods/:id', adminMiddleware, updatePaymentMethod);

// ===============================
// Exchange Rate Management
// ===============================
router.post('/exchange-rate', adminMiddleware, updateExchangeRate);

// ===============================
// Payment Admin: Withdrawal routes
// ===============================
router.get('/payments/withdrawals', adminMiddleware, adminPaymentController.getWithdrawals);

// ===============================
// Payment Admin: Deposits & Logs
// ===============================
router.get('/payments/deposits', adminMiddleware, adminPaymentController.getDeposits);
router.get('/payments/webhook-logs', adminMiddleware, adminPaymentController.getWebhookLogs);

export default router;