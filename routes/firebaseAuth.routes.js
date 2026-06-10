import express from 'express';

import {
  syncFirebaseUser,
  getFirebaseProfile,
  updateFirebasePassword,
  sendOtp,
  verifyOtp
} from '../controllers/firebaseAuth.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/sync', syncFirebaseUser);
router.get('/me', firebaseProtect, getFirebaseProfile);
router.put('/password', firebaseProtect, updateFirebasePassword);

export default router;