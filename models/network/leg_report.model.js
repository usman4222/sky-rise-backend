import mongoose from 'mongoose';

const legReportSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  legUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  legBusinessVolume: {
    type: Number,
    default: 0 // Personal active investments of legUser + their entire downline
  },
  isActive: {
    type: Boolean,
    default: false // Whether the direct referral represents an active leg
  }
}, {
  timestamps: true,
  collection: 'leg_reports'
});

// A user can only have one leg report entry per direct referral
legReportSchema.index({ user: 1, legUser: 1 }, { unique: true });

export default mongoose.model('LegReport', legReportSchema);
