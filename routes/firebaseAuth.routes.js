import express from 'express';

import {
  syncFirebaseUser,
  getFirebaseProfile,
  updateFirebasePassword,
  sendOtp,
  verifyOtp
} from '../controllers/firebaseAuth.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { otpRateLimiter, authRateLimiter, firebaseSyncRateLimiter } from '../middleware/security.js';
import { verifyCaptcha } from '../middleware/captcha.js';

const router = express.Router();

router.post('/send-otp', otpRateLimiter, sendOtp);
router.post('/verify-otp', otpRateLimiter, verifyOtp);
router.post('/sync', firebaseSyncRateLimiter, syncFirebaseUser);
router.post('/verify-signup', verifyCaptcha, async (req, res) => {
  try {
    const { sponsorCode } = req.body;
    if (sponsorCode) {
      const User = (await import('../models/auth/user.model.js')).default;
      const sponsorUser = await User.findOne({ referralCode: sponsorCode.trim() });
      if (!sponsorUser) {
        return res.status(400).json({ success: false, message: 'Invalid sponsor referral code' });
      }
      if (sponsorUser.canEarnReferral === false || sponsorUser.isBlocked || sponsorUser.status === 'suspended' || sponsorUser.status === 'SUSPENDED_EMAIL_UNVERIFIED') {
        return res.status(400).json({ success: false, message: "You cannot use a suspended user's referral code. Please try another." });
      }
    }
    return res.status(200).json({ success: true, message: 'Validation successful' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Verification error', error: error.message });
  }
});
router.get('/me', firebaseProtect, getFirebaseProfile);
router.put('/password', firebaseProtect, authRateLimiter, updateFirebasePassword);

export default router;