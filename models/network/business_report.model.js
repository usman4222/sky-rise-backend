import mongoose from 'mongoose';

const businessReportSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  directBusiness: {
    type: Number,
    default: 0
  },
  fiveLevelBusiness: {
    type: Number,
    default: 0 // Direct + Indirect business up to 5 levels (Bronze Spark... Supreme Spark)
  },
  totalTeamBusiness: {
    type: Number,
    default: 0 // Unlimited depth business
  },
  selfInvestment: {
    type: Number,
    default: 0 // User's own total active investment amount
  }
}, {
  timestamps: true,
  collection: 'business_reports'
});

export default mongoose.model('BusinessReport', businessReportSchema);
