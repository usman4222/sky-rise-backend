import express from 'express';
const router = express.Router();

import investmentController from '../controllers/investment.controller.js';
const {
    getPackages,
    purchasePackage,
    getMyInvestments,
    withdrawCapital
} = investmentController;

import { firebaseProtect } from '../middleware/firebaseAuth.js';

router.get('/packages', firebaseProtect, getPackages);
router.post('/purchase', firebaseProtect, purchasePackage);
router.get('/my-investments', firebaseProtect, getMyInvestments);
router.post('/withdraw-capital', firebaseProtect, withdrawCapital);

export default router;