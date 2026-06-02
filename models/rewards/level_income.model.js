import mongoose from 'mongoose';

const levelIncomeSchema = new mongoose.Schema({
  upline: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  downline: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  roiHistory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RoiHistory',
    required: true
  },
  level: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  commissionPercent: {
    type: Number,
    required: true // e.g. 8 (for 8%)
  },
  amount: {
    type: Number,
    required: true // (downline_ROI_amount) * commissionPercent / 100
  }
}, {
  timestamps: true,
  collection: 'level_income'
});

export default mongoose.model('LevelIncome', levelIncomeSchema);
