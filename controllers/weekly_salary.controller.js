import WeeklySalaryRequest from '../models/finance/weekly_salary_request.model.js';
import VipQualification from '../models/rewards/vip_qualification.model.js';
import VipRank from '../models/rewards/vip_rank.model.js';
import Notification from '../models/system/notification.model.js';
import { successResponse, sendError } from '../utils/response.js';

// @desc    Get user weekly salary eligibility
// @route   GET /api/weekly-salary/eligibility
// @access  Private
export const getSalaryEligibility = async (req, res) => {
  try {
    const userId = req.user._id;
    const vipRankLevel = req.user.vipRank || 0;

    // Get VIP Rank details
    let eligibleAmount = 0;
    let rankName = 'None';
    if (vipRankLevel > 0) {
      const rank = await VipRank.findOne({ level: vipRankLevel });
      if (rank) {
        eligibleAmount = rank.weeklySalary;
        rankName = rank.name;
      }
    }

    // Get Qualification details
    const qualification = await VipQualification.findOne({ user: userId });

    // Check if salary was already requested/approved in the current weekly period
    const periodMs = process.env.ROI_TEST_MODE === 'true' ? 7 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const sinceDate = new Date(Date.now() - periodMs);

    const pendingRequest = await WeeklySalaryRequest.findOne({
      user: userId,
      status: 'pending'
    });

    const approvedRequestInPeriod = await WeeklySalaryRequest.findOne({
      user: userId,
      status: { $in: ['approved', 'credited'] },
      createdAt: { $gte: sinceDate }
    });

    const canRequest = vipRankLevel > 0 && !pendingRequest && !approvedRequestInPeriod;

    let restrictionReason = null;
    if (vipRankLevel === 0) {
      restrictionReason = 'You do not hold a qualified VIP rank to claim weekly salary.';
    } else if (pendingRequest) {
      restrictionReason = 'You have a pending weekly salary request awaiting review.';
    } else if (approvedRequestInPeriod) {
      restrictionReason = `You have already received your weekly salary for this period. Please wait until the next salary cycle.`;
    }

    return successResponse(res, 'Eligibility details retrieved', {
      eligibility: {
        currentRank: vipRankLevel,
        rankName,
        eligibleAmount,
        qualification,
        canRequest,
        restrictionReason,
        periodDurationMinutes: process.env.ROI_TEST_MODE === 'true' ? 7 : 10080
      }
    });
  } catch (error) {
    console.error('getSalaryEligibility error:', error);
    return sendError(res, 'Failed to retrieve eligibility details', 500, error);
  }
};

// @desc    Submit request for weekly salary
// @route   POST /api/weekly-salary/request
// @access  Private
export const requestWeeklySalary = async (req, res) => {
  try {
    const userId = req.user._id;
    const vipRankLevel = req.user.vipRank || 0;

    if (vipRankLevel === 0) {
      return sendError(res, 'You do not qualify for any weekly VIP salary.', 400);
    }

    // Load rank details
    const rank = await VipRank.findOne({ level: vipRankLevel });
    if (!rank) {
      return sendError(res, 'VIP rank configuration not found', 400);
    }

    // Check pending request
    const pendingRequest = await WeeklySalaryRequest.findOne({
      user: userId,
      status: 'pending'
    });
    if (pendingRequest) {
      return sendError(res, 'You already have a pending weekly salary request under review.', 400);
    }

    // Check claims in current period
    const periodMs = process.env.ROI_TEST_MODE === 'true' ? 7 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const sinceDate = new Date(Date.now() - periodMs);

    const approvedRequestInPeriod = await WeeklySalaryRequest.findOne({
      user: userId,
      status: { $in: ['approved', 'credited'] },
      createdAt: { $gte: sinceDate }
    });
    if (approvedRequestInPeriod) {
      return sendError(res, 'You have already received your weekly salary for this period.', 400);
    }

    // Get snapshot of legs volume
    const qualification = await VipQualification.findOne({ user: userId });
    const snapshot = qualification ? qualification.toObject() : {
      user: userId,
      currentRank: vipRankLevel,
      legsSnapshotMissing: true,
      timestamp: new Date()
    };

    const newRequest = await WeeklySalaryRequest.create({
      user: userId,
      vipRank: vipRankLevel,
      salaryAmount: rank.weeklySalary,
      qualificationSnapshot: snapshot,
      status: 'pending',
      notes: req.body.notes || ''
    });

    // Notify user
    await Notification.create({
      user: userId,
      title: 'Weekly Salary Request Submitted',
      message: `Your weekly salary claim request of $${rank.weeklySalary} has been successfully submitted and is pending admin approval.`,
      category: 'rank'
    });

    return successResponse(res, 'Weekly salary request submitted successfully', { request: newRequest }, 201);
  } catch (error) {
    console.error('requestWeeklySalary error:', error);
    return sendError(res, 'Failed to submit salary request', 500, error);
  }
};

// @desc    Get user own salary request history
// @route   GET /api/weekly-salary/my-requests
// @access  Private
export const getMySalaryRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    const totalItems = await WeeklySalaryRequest.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const requests = await WeeklySalaryRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return successResponse(res, 'Weekly salary history retrieved successfully', {
      requests,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getMySalaryRequests error:', error);
    return sendError(res, 'Failed to get weekly salary requests', 500, error);
  }
};
