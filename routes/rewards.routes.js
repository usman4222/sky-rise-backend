import express from 'express';
import rewardsController from '../controllers/rewards.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';

const { getVipStatus, getAchievements, getLeadershipStatus, recoverLeadershipRewards } = rewardsController;
const router = express.Router();

router.get('/vip-status', firebaseProtect, getVipStatus);
router.get('/achievements', firebaseProtect, getAchievements);
router.get('/leadership-status', firebaseProtect, getLeadershipStatus);
router.post('/recover-leadership-rewards', firebaseProtect, recoverLeadershipRewards);

export default router;
