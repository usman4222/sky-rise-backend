import mongoose from 'mongoose';

const leadershipRewardSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  downlineUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userInvestment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserInvestment',
    required: true
  },
  rewardName: {
    type: String,
    required: true,
    enum: [
      'Starter Leadership Reward',
      'Growth Leadership Reward',
      'Achievement Leadership Reward',
      'Elite Leadership Reward',
      'Global Investor Reward'
    ]
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['paid', 'missed', 'recovered'],
    default: 'paid',
    index: true
  },
  targetTier: {
    type: Number,
    required: true,
    default: 1
  },
  recoveredAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'leadership_rewards'
});

export default mongoose.model('LeadershipReward', leadershipRewardSchema);
