import express from 'express';
import adminController from '../controllers/admin.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { restrictTo } from '../middleware/rbac.js';

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

// Firebase auth + ADMIN / SUPER_ADMIN role protection
const adminMiddleware = [
  firebaseProtect,
  restrictTo('ADMIN', 'SUPER_ADMIN')
];

// ===============================
// Admin Dashboard
// ===============================
router.get('/dashboard', adminMiddleware, getAdminDashboard);

// ===============================
// Deposit Management
// ===============================
router.get('/deposits', adminMiddleware, adminController.getAdminDeposits);
router.post('/deposits/:id/action', adminMiddleware, processDeposit);

// ===============================
// Withdrawal Management
// ===============================
router.get('/withdrawals', adminMiddleware, adminController.getAdminWithdrawals);
router.post('/withdrawals/:id/action', adminMiddleware, processWithdrawal);

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

export default router;