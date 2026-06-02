import mongoose from 'mongoose';

const capitalWithdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userInvestment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserInvestment',
    required: true,
    index: true
  },
  originalCapital: {
    type: Number,
    required: true // Original realAmountPaid
  },
  penaltyDeduction: {
    type: Number,
    required: true // 15% deduction amount
  },
  roiDeduction: {
    type: Number,
    required: true // All previously accumulated ROI that must be deducted
  },
  finalPayableAmount: {
    type: Number,
    required: true // Remaining capital sent to withdrawal/deposit wallet
  }
}, {
  timestamps: true,
  collection: 'capital_withdrawals'
});

export default mongoose.model('CapitalWithdrawal', capitalWithdrawalSchema);
