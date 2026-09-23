import mongoose from 'mongoose';

const achievementRewardSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  achievementRank: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AchievementRank',
    required: true
  },
  rewardAmount: {
    type: Number,
    required: true
  },
  achievedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'achievement_rewards'
});

// Prevent duplicate achievement rewards for the same user and rank
achievementRewardSchema.index({ user: 1, achievementRank: 1 }, { unique: true });

export default mongoose.model('AchievementReward', achievementRewardSchema);
