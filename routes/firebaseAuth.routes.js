import express from 'express';

import {
  syncFirebaseUser,
  getFirebaseProfile,
  updateFirebasePassword,
  sendOtp,
  verifyOtp
} from '../controllers/firebaseAuth.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { otpRateLimiter, authRateLimiter } from '../middleware/security.js';

const router = express.Router();

router.post('/send-otp', otpRateLimiter, sendOtp);
router.post('/verify-otp', otpRateLimiter, verifyOtp);
router.post('/sync', authRateLimiter, syncFirebaseUser);
router.get('/me', firebaseProtect, getFirebaseProfile);
router.put('/password', firebaseProtect, authRateLimiter, updateFirebasePassword);

export default router;