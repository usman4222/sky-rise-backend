import mongoose from 'mongoose';

const levelUnlockSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  level: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  feePaid: {
    type: Number,
    required: true,
    default: 0 // Level 1 is free (0 fee)
  },
  realAmountPaid: {
    type: Number,
    required: true,
    default: 0
  },
  bonusAmountPaid: {
    type: Number,
    required: true,
    default: 0
  }
}, {
  timestamps: true,
  collection: 'level_unlocks'
});

// A user can only unlock a level once
levelUnlockSchema.index({ user: 1, level: 1 }, { unique: true });

export default mongoose.model('LevelUnlock', levelUnlockSchema);
