import mongoose from 'mongoose';

const directReferralIncomeSchema = new mongoose.Schema({
  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userInvestment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserInvestment',
    required: true
  },
  investmentAmountReal: {
    type: Number,
    required: true // The real cash deposit used for purchasing investment
  },
  commissionPercent: {
    type: Number,
    required: true,
    default: 8 // 8% commission
  },
  commissionAmount: {
    type: Number,
    required: true // calculated as: investmentAmountReal * (commissionPercent / 100)
  }
}, {
  timestamps: true,
  collection: 'direct_referral_income'
});

export default mongoose.model('DirectReferralIncome', directReferralIncomeSchema);
