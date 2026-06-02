import express from 'express';
const router = express.Router();

import investmentController from '../controllers/investment.controller.js';
const {
    getPackages,
    purchasePackage,
    getMyInvestments,
    withdrawCapital,
    getRoiHistory
} = investmentController;

import { firebaseProtect, firebaseProtectOptional } from '../middleware/firebaseAuth.js';

router.get('/packages', firebaseProtectOptional, getPackages);
router.post('/purchase', firebaseProtect, purchasePackage);
router.get('/my-investments', firebaseProtect, getMyInvestments);
router.post('/withdraw-capital', firebaseProtect, withdrawCapital);
router.get('/roi-history', firebaseProtect, getRoiHistory);

export default router;