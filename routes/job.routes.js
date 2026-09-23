import express from 'express';
const router = express.Router();

import jobController from '../controllers/job.controller.js';
const { triggerDailyRoiJob, triggerVipSalaryJob, triggerAchievementsCheck } = jobController;

router.get('/daily-roi', triggerDailyRoiJob);
router.post('/daily-roi', triggerDailyRoiJob);

router.get('/vip-salary', triggerVipSalaryJob);
router.post('/vip-salary', triggerVipSalaryJob);

router.get('/achievements/:userId', triggerAchievementsCheck);
router.post('/achievements/:userId', triggerAchievementsCheck);

export default router;
