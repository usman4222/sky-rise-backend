import express from 'express';

import {
  syncFirebaseUser,
  getFirebaseProfile
} from '../controllers/firebaseAuth.controller.js';

import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

router.post('/sync', syncFirebaseUser);

router.get('/me', firebaseProtect, getFirebaseProfile);

export default router;