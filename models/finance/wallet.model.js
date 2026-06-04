import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  deposit: {
    type: Number,
    default: 0,
    min: [0, 'Deposit balance cannot be negative']
  },
  freeRegBonus: {
    type: Number,
    default: 0,
    min: [0, 'Free registration bonus cannot be negative']
  },
  roi: {
    type: Number,
    default: 0,
    min: [0, 'ROI earnings cannot be negative']
  },
  referral: {
    type: Number,
    default: 0,
    min: [0, 'Referral earnings cannot be negative']
  },
  bonusActivation: {
    type: Number,
    default: 0, // 50% of Free Registration Team Bonus (only for level activation)
    min: [0, 'Bonus activation balance cannot be negative']
  },
  bonusTransferable: {
    type: Number,
    default: 0, // 50% of Free Registration Team Bonus (transferable to downline)
    min: [0, 'Bonus transferable balance cannot be negative']
  },
  bonusReceived: {
    type: Number,
    default: 0, // Received transfer balance (used up to 10% in investments)
    min: [0, 'Bonus received balance cannot be negative']
  },
  salary: {
    type: Number,
    default: 0,
    min: [0, 'Salary balance cannot be negative']
  },
  achievement: {
    type: Number,
    default: 0,
    min: [0, 'Achievement rewards cannot be negative']
  },
  withdrawal: {
    type: Number,
    default: 0, // Keeps track of pending / processed withdrawal total
    min: [0, 'Withdrawal total cannot be negative']
  }
}, {
  timestamps: true,
  collection: 'wallets'
});

export default mongoose.model('Wallet', walletSchema);
