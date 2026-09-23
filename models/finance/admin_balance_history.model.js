import mongoose from 'mongoose';

const adminBalanceHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  username: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    required: true
  },
  amountAdded: {
    type: Number,
    default: 0
  },
  amountDeducted: {
    type: Number,
    default: 0
  },
  balanceType: {
    type: String,
    enum: ['deposit', 'adminAllocated'],
    required: true
  },
  balanceBefore: {
    type: Number,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminName: {
    type: String,
    required: true
  },
  remarks: {
    type: String,
    default: ''
  },
  referenceNumber: {
    type: String,
    required: true,
    unique: true
  }
}, {
  timestamps: true,
  collection: 'admin_balance_history'
});

export default mongoose.model('AdminBalanceHistory', adminBalanceHistorySchema);
