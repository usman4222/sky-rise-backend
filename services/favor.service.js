import mongoose from 'mongoose';
import User from '../models/auth/user.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import Notification from '../models/system/notification.model.js';

export const calculateQualifyingBusiness = async (userId, startDate, endDate) => {
  try {
    const userNode = await ReferralTree.findOne({ user: userId });
    if (!userNode) return 0;

    const descendants = await ReferralTree.find({ ancestors: userId });
    if (descendants.length === 0) return 0;

    const descendantIds = descendants.map(d => d.user.toString());

    // Find standard investments (not admin funded) in the given cycle date range
    const investments = await UserInvestment.find({
      user: { $in: descendantIds },
      status: { $in: ['active', 'completed'] },
      packageType: { $ne: 'Admin Funded Package' },
      createdAt: { $gte: startDate, $lte: endDate }
    });

    if (investments.length === 0) return 0;

    const allAncestorIds = new Set();
    descendants.forEach(d => {
      d.ancestors.forEach(a => allAncestorIds.add(a.toString()));
    });

    const favorEnabledUsers = await User.find({
      _id: { $in: Array.from(allAncestorIds) },
      favorConditionEnabled: true
    }).select('_id');

    const favorEnabledUserIds = new Set(favorEnabledUsers.map(u => u._id.toString()));

    let totalBusiness = 0;
    for (const inv of investments) {
      const investorId = inv.user.toString();
      const memberTree = descendants.find(d => d.user.toString() === investorId);
      if (!memberTree) continue;

      let closestFavorAncestorId = null;
      for (const ancestor of memberTree.ancestors) {
        const ancestorStr = ancestor.toString();
        if (favorEnabledUserIds.has(ancestorStr)) {
          closestFavorAncestorId = ancestorStr;
          break;
        }
      }

      if (closestFavorAncestorId === userId.toString()) {
        totalBusiness += inv.amount;
      }
    }

    return totalBusiness;
  } catch (error) {
    console.error(`Error calculating qualifying business for ${userId}:`, error);
    return 0;
  }
};

export const syncFavorConditionStatus = async (user) => {
  if (!user || !user.favorConditionEnabled) return user;

  const now = new Date();
  
  // Set default cycle start/end if not initialized yet
  if (!user.favorCycleStartDate) {
    user.favorCycleStartDate = user.createdAt || now;
    const duration = process.env.ROI_TEST_MODE === 'true' ? 3 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    user.favorCycleEndDate = new Date(user.favorCycleStartDate.getTime() + duration);
    user.favorRequiredBusiness = user.favorAmount;
    user.favorWithdrawalStatus = 'active';
    user.favorSentWarnings = [];
    await user.save();
  }

  // Calculate current achieved business in the cycle
  const achievedBusiness = await calculateQualifyingBusiness(
    user._id,
    user.favorCycleStartDate,
    user.favorCycleEndDate
  );

  // Check if requirement is met
  if (achievedBusiness >= user.favorRequiredBusiness) {
    user.favorWithdrawalStatus = 'active';
    user.favorManualOverride = false; // Reset override on natural qualification
    user.favorLastQualificationDate = now;
    
    // Start next cycle automatically
    user.favorCycleStartDate = now;
    const duration = process.env.ROI_TEST_MODE === 'true' ? 3 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    user.favorCycleEndDate = new Date(now.getTime() + duration);
    user.favorRequiredBusiness = user.favorAmount;
    user.favorSentWarnings = [];
    
    await user.save();

    // Send Completion Notification
    await Notification.create({
      user: user._id,
      title: '🏆 Target Achieved',
      message: 'Congratulations! You have successfully completed your monthly 1X business target. Your withdrawal remains active.',
      category: 'system'
    });
  } else {
    // If not completed and cycle deadline has passed
    if (now > user.favorCycleEndDate && !user.favorManualOverride) {
      if (user.favorWithdrawalStatus !== 'blocked') {
        user.favorWithdrawalStatus = 'blocked';
        await user.save();

        // Send Expiry Notification
        await Notification.create({
          user: user._id,
          title: '⚠️ Target Expired',
          message: 'Your monthly 1X business requirement has not been completed. Your withdrawal has been temporarily suspended.',
          category: 'system'
        });
      }
    }
  }

  return user;
};

export const checkFavorWarningsAndExpiring = async () => {
  try {
    const users = await User.find({ favorConditionEnabled: true });
    const now = new Date();

    for (const user of users) {
      try {
        await syncFavorConditionStatus(user);

        // Reload user to check for updated details
        const updatedUser = await User.findById(user._id);
        if (!updatedUser || !updatedUser.favorConditionEnabled) continue;

        const diffTime = updatedUser.favorCycleEndDate.getTime() - now.getTime();
        if (diffTime <= 0) continue; // Already handled by sync

        let remainingUnits;
        const isTest = process.env.ROI_TEST_MODE === 'true';
        if (isTest) {
          remainingUnits = Math.ceil(diffTime / 1000); // seconds remaining in test mode
        } else {
          remainingUnits = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // days remaining
        }

        const warningThresholds = isTest ? [120, 60, 30, 10] : [10, 5, 3, 1];
        
        for (const threshold of warningThresholds) {
          if (remainingUnits <= threshold && !updatedUser.favorSentWarnings.includes(threshold)) {
            const unitStr = isTest ? 'seconds' : 'days';
            await Notification.create({
              user: updatedUser._id,
              title: '⚠️ Target Deadline Warning',
              message: `Your monthly 1X business requirement has ${remainingUnits} ${unitStr} remaining. Target: $${updatedUser.favorRequiredBusiness}.`,
              category: 'system'
            });

            updatedUser.favorSentWarnings.push(threshold);
            await updatedUser.save();
            break; // Send only one warning per check run
          }
        }
      } catch (err) {
        console.error(`Error processing favor sync for user ${user._id}:`, err);
      }
    }
  } catch (error) {
    console.error('Error running checkFavorWarningsAndExpiring:', error);
  }
};
