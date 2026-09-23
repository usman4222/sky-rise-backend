import mongoose from 'mongoose';

const investmentPackageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  minAmount: {
    type: Number,
    required: true
  },
  maxAmount: {
    type: Number,
    default: null // Null represents unlimited (e.g. Package D)
  },
  startRoi: {
    type: Number,
    required: true // in %, e.g., 0.7
  },
  maxRoi: {
    type: Number,
    required: true // in %, e.g., 1.2
  },
  roiIncrement: {
    type: Number,
    default: 0.1 // daily % increase (e.g. +0.1%)
  },
  roiIncrementDays: {
    type: Number,
    default: 10 // increase interval in days
  },
  autoReinvest: {
    type: Boolean,
    default: true
  },
  manualClaim: {
    type: Boolean,
    default: false
  },
  claimExpiryHours: {
    type: Number,
    default: 24
  },
  earlyWithdrawalPenaltyPercent: {
    type: Number,
    default: 15 // 15% capital deduction
  },
  earlyWithdrawalPenaltyMonths: {
    type: Number,
    default: 5 // early withdraw penalty window (5 months)
  },
  isHidden: {
    type: Boolean,
    default: false // Set to true for Package E (Admin development)
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  packageTarget: {
    type: String,
    enum: ['user', 'marketer'],
    default: 'user',
    index: true
  }
}, {
  timestamps: true,
  collection: 'investment_packages'
});

export default mongoose.model('InvestmentPackage', investmentPackageSchema);
