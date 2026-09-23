import mongoose from 'mongoose';

const roiHistorySchema = new mongoose.Schema({
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
  amount: {
    type: Number,
    required: true
  },
  roiPercent: {
    type: Number,
    required: true // e.g. 0.8 (for 0.8%)
  },
  isCompounded: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['paid', 'reversed'],
    default: 'paid',
    index: true
  }
}, {
  timestamps: true,
  collection: 'roi_history'
});

export default mongoose.model('RoiHistory', roiHistorySchema);
