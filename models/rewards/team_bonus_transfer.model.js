import mongoose from 'mongoose';

const teamBonusTransferSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0.01, 'Transfer amount must be positive']
  },
  level: {
    type: Number,
    required: true,
    min: 1,
    max: 5 // Transfers allowed only within 5-level downline
  }
}, {
  timestamps: true,
  collection: 'team_bonus_transfers'
});

export default mongoose.model('TeamBonusTransfer', teamBonusTransferSchema);
