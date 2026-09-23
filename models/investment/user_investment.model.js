import mongoose from 'mongoose';

const userInvestmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  package: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InvestmentPackage',
    required: true
  },
  amount: {
    type: Number,
    required: true // Total active investment size (Real + Bonus)
  },
  status: {
    type: String,
    enum: ['active', 'withdrawn', 'completed'],
    default: 'active',
    index: true
  },
  currentRoi: {
    type: Number,
    required: true // Current daily ROI %, starts at package's startRoi
  },
  lastIncrementAt: {
    type: Date,
    default: Date.now // Tracks when currentRoi last grew by 0.1%
  },
  lastPayoutAt: {
    type: Date,
    default: Date.now
  },
  totalRoiEarned: {
    type: Number,
    default: 0
  },
  autoReinvest: {
    type: Boolean,
    default: true
  },
  pendingRoiClaim: {
    type: Number,
    default: 0
  },
  claimExpiresAt: {
    type: Date,
    default: null
  },
  roiClaimMode: {
    type: String,
    enum: ['auto', 'manual'],
    default: 'auto'
  },
  packageType: {
    type: String,
    enum: ['Standard', 'Admin Funded Package'],
    default: 'Standard',
    index: true
  },
  closeDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'user_investments'
});

export default mongoose.model('UserInvestment', userInvestmentSchema);
