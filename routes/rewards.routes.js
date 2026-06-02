import express from 'express';
import rewardsController from '../controllers/rewards.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';

const { getVipStatus, getAchievements } = rewardsController;
const router = express.Router();

router.get('/vip-status', firebaseProtect, getVipStatus);
router.get('/achievements', firebaseProtect, getAchievements);

export default router;
