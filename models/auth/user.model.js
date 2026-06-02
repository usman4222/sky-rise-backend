import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },

  name: { type: String, required: true, trim: true },

  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },

  phone: { type: String, required: true, trim: true },

  sponsor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  referralCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },

  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active'
  },

  kycStatus: {
    type: String,
    enum: ['unsubmitted', 'pending', 'approved', 'rejected'],
    default: 'unsubmitted'
  },

  registrationBonusActive: { type: Boolean, default: true },

  teamBonusDeadline: { type: Date, default: null },

  unlockedLevels: { type: [Number], default: [1] },

  vipRank: { type: Number, default: 0 },

  achievementRank: { type: Number, default: 0 }

}, { timestamps: true, collection: 'users' });

export default mongoose.model('User', userSchema);