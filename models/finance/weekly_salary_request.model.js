import mongoose from 'mongoose';

const weeklySalaryRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vipRank: {
    type: Number,
    required: true
  },
  salaryAmount: {
    type: Number,
    required: true
  },
  qualificationSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'credited'],
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
  walletHistoryRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletHistory',
    default: null
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'weekly_salary_requests'
});

export default mongoose.model('WeeklySalaryRequest', weeklySalaryRequestSchema);
