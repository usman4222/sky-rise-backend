import express from 'express';

import networkController from '../controllers/network.controller.js';
const { getUplines, getDownline, unlockLevel } = networkController;

import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

router.get('/uplines', firebaseProtect, getUplines);
router.get('/downline', firebaseProtect, getDownline);
router.post('/unlock-level', firebaseProtect, unlockLevel);

export default router;