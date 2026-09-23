import mongoose from 'mongoose';

const backgroundJobSchema = new mongoose.Schema(
  {
    jobName: {
      type: String,
      required: true,
      index: true // e.g. 'DAILY_ROI_PAYOUT', 'WEEKLY_VIP_SALARY', 'ACHIEVEMENT_REWARDS_CHECK'
    },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed'],
      required: true,
      index: true
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    completedAt: {
      type: Date,
      default: null
    },
    affectedRecords: {
      type: Number,
      default: 0
    },
    errorDetails: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true,
    collection: 'background_jobs'
  }
);

const BackgroundJob = mongoose.model('BackgroundJob', backgroundJobSchema);

export default BackgroundJob;