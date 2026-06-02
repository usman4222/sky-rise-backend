import mongoose from 'mongoose';

const earningRuleSchema = new mongoose.Schema({
  ruleName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true // e.g. 'direct_referral_percent', 'level_income_distribution', 'level_unlock_fee'
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    required: true
  }
}, {
  timestamps: true,
  collection: 'earning_rules'
});

export default mongoose.model('EarningRule', earningRuleSchema);
