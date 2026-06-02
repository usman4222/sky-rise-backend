import express from 'express';

import {
  syncFirebaseUser,
  getFirebaseProfile,
  updateFirebasePassword
} from '../controllers/firebaseAuth.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

router.post('/sync', syncFirebaseUser);
router.get('/me', firebaseProtect, getFirebaseProfile);
router.put('/password', firebaseProtect, updateFirebasePassword);

export default router;