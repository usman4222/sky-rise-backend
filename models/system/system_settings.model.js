import mongoose from 'mongoose';

const systemSettingsSchema = new mongoose.Schema(
  {
    maintenanceMode: {
      type: Boolean,
      default: false
    },
    kycRequiredForWithdrawal: {
      type: Boolean,
      default: true
    },
    minWithdrawalAmount: {
      type: Number,
      default: 10 // $10 minimum withdrawal
    },
    withdrawalFeePercent: {
      type: Number,
      default: 5 // 5% flat fee on withdrawals
    },
    enabledModules: {
      type: [String],
      default: ['roi', 'referral', 'level_income', 'salary', 'achievements', 'transfers']
    }
  },
  {
    timestamps: true,
    collection: 'system_settings'
  }
);

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

export default SystemSettings;