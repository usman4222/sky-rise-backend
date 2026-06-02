import mongoose from 'mongoose';

const investmentPaymentSchema = new mongoose.Schema({
  userInvestment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserInvestment',
    required: true,
    unique: true, // 1-to-1 relationship with UserInvestment
    index: true
  },
  realAmountPaid: {
    type: Number,
    required: true,
    default: 0
  },
  freeRegBonusPaid: {
    type: Number,
    required: true,
    default: 0
  },
  teamBonusReceivedPaid: {
    type: Number,
    required: true,
    default: 0 // Received transfer balance (utility)
  },
  totalAmount: {
    type: Number,
    required: true
  }
}, {
  timestamps: true,
  collection: 'investment_payments'
});

export default mongoose.model('InvestmentPayment', investmentPaymentSchema);
