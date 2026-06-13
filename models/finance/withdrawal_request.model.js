import mongoose from 'mongoose';

const withdrawalRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  walletType: {
    type: String,
    enum: ['roi', 'referral', 'salary', 'achievement'],
    required: true
  },
  amountRequested: {
    type: Number,
    required: true,
    min: [10, 'Minimum withdrawal amount is $10']
  },
  withdrawalFee: {
    type: Number,
    required: true
  },
  netAmount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserPaymentMethod',
    required: true
  },
  paymentMethodSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'paid', 'cancelled'],
    default: 'pending',
    index: true
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  rejectionReason: {
    type: String,
    default: null
  },
  adminNote: {
    type: String,
    default: ''
  },
  transactionId: {
    type: String,
    default: null
  },
  walletHistoryDebitRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletHistory',
    default: null
  },
  walletHistoryRefundRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletHistory',
    default: null
  },
  isAdminFundedUser: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  collection: 'withdrawal_requests'
});

export default mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
