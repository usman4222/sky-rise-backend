import mongoose from 'mongoose';

const referralTreeSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  // Array of all ancestor user IDs.
  // Index 0 is direct sponsor (referredBy), index 1 is Level 2 upline, etc.
  ancestors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  }],
  teamSize: {
    type: Number,
    default: 0
  },
  directReferralsCount: {
    type: Number,
    default: 0
  },
  activeDirectReferralsCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  collection: 'referral_tree'
});

// Compound index for fast queries of downline members at specific level depths
// e.g. finding all Level L downline members of A: ancestors: A, position of A in ancestors list = L - 1.
referralTreeSchema.index({ ancestors: 1, user: 1 });

export default mongoose.model('ReferralTree', referralTreeSchema);
