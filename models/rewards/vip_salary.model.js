import mongoose from 'mongoose';

const vipSalarySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vipRank: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  amount: {
    type: Number,
    required: true
  },
  payoutPeriodStart: {
    type: Date,
    required: true
  },
  payoutPeriodEnd: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['paid', 'failed'],
    default: 'paid',
    index: true
  },
  walletHistoryRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletHistory',
    default: null
  }
}, {
  timestamps: true,
  collection: 'vip_salary'
});

export default mongoose.model('VipSalary', vipSalarySchema);
