// Reward Engine triggers
import rewardEngine from '../utils/rewardEngine.js';
const { runDailyRoiPayout, runWeeklyVipSalaryPayout, checkAchievementRewards } = rewardEngine;

// Response helpers
import { sendError, successResponse } from '../utils/response.js';

// @desc    Trigger Daily ROI payout background job simulation
// @route   POST /api/jobs/daily-roi
// @access  Public (or protected by secure key)
const triggerDailyRoiJob = async (req, res) => {
  try {
    // Run async in background or wait
    await runDailyRoiPayout();
    return successResponse(res, 'Daily ROI Payout and 10-level team ROI commission distribution executed successfully!');
  } catch (error) {
    console.error('triggerDailyRoiJob error:', error.message);
    return sendError(res, 'Job execution error', 500, error);
  }
};

// @desc    Trigger Weekly VIP Salary background job simulation
// @route   POST /api/jobs/vip-salary
// @access  Public
const triggerVipSalaryJob = async (req, res) => {
  try {
    await runWeeklyVipSalaryPayout();
    return successResponse(res, 'Weekly VIP Ranks verification and fixed salary payout job executed successfully!');
  } catch (error) {
    console.error('triggerVipSalaryJob error:', error.message);
    return sendError(res, 'Job execution error', 500, error);
  }
};

// @desc    Trigger User Spark Achievements check simulation
// @route   POST /api/jobs/achievements/:userId
// @access  Public
const triggerAchievementsCheck = async (req, res) => {
  try {
    const { userId } = req.params;
    await checkAchievementRewards(userId);
    return successResponse(res, `Checked Spark Achievements milestones successfully for user ${userId}!`);
  } catch (error) {
    console.error('triggerAchievementsCheck error:', error.message);
    return sendError(res, 'Job execution error', 500, error);
  }
};

export default {
  triggerDailyRoiJob,
  triggerVipSalaryJob,
  triggerAchievementsCheck
};
