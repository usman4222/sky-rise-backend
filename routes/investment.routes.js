import express from 'express';
const router = express.Router();

import investmentController from '../controllers/investment.controller.js';
const {
    getPackages,
    purchasePackage,
    getMyInvestments,
    withdrawCapital,
    getRoiHistory,
    toggleAutoReinvest,
    claimDailyRoi
} = investmentController;

import { firebaseProtect, firebaseProtectOptional } from '../middleware/firebaseAuth.js';
import { financeRateLimiter, requestLockGuard } from '../middleware/security.js';

router.get('/packages', firebaseProtectOptional, getPackages);
router.post('/purchase', firebaseProtect, financeRateLimiter, requestLockGuard, purchasePackage);
router.get('/my-investments', firebaseProtect, getMyInvestments);
router.post('/withdraw-capital', firebaseProtect, financeRateLimiter, requestLockGuard, withdrawCapital);
router.get('/roi-history', firebaseProtect, getRoiHistory);
router.post('/:id/toggle-reinvest', firebaseProtect, toggleAutoReinvest);
router.post('/:id/claim-roi', firebaseProtect, financeRateLimiter, requestLockGuard, claimDailyRoi);

export default router;