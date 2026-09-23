import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sourceWallet: {
    type: String,
    enum: ['roi', 'referral', 'salary', 'achievement', 'deposit', 'bonusReceived', 'bonusTransferable'],
    required: true
  },
  // Currency the user wants to receive: PKR (bank/jazzcash/easypaisa/raast) or USDT (TRC20/CoinPayments)
  withdrawalCurrency: {
    type: String,
    enum: ['PKR', 'USDT'],
    required: true,
    default: 'PKR'
  },
  amountUSDT: {
    type: Number,
    required: true
  },
  // PKR equivalent at time of request - null for USDT withdrawals
  amountPKR: {
    type: Number,
    default: null
  },
  // Exchange rate at time of request - null for USDT withdrawals
  exchangeRate: {
    type: Number,
    default: null
  },
  feeUSDT: {
    type: Number,
    default: 0
  },
  payableAmountUSDT: {
    type: Number,
    required: true
  },
  // PKR payable amount - null for USDT withdrawals
  payableAmountPKR: {
    type: Number,
    default: null
  },
  withdrawalAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WithdrawalAccount',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  // Transaction ID / blockchain tx hash / bank ref provided by admin on approval
  txHash: {
    type: String,
    default: null
  },
  remarks: {
    type: String,
    default: ''
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'withdrawals'
});

export default mongoose.model('Withdrawal', withdrawalSchema);
