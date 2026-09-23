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

  phone: { type: String, required: false, trim: true, default: '' },

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
    enum: ['pending_verification', 'active', 'suspended', 'SUSPENDED_EMAIL_UNVERIFIED'],
    default: 'pending_verification'
  },

  isBlocked: {
    type: Boolean,
    default: false
  },

  canLogin: {
    type: Boolean,
    default: true
  },

  canDeposit: {
    type: Boolean,
    default: true
  },

  canInvest: {
    type: Boolean,
    default: true
  },

  canWithdraw: {
    type: Boolean,
    default: true
  },

  canEarnReferral: {
    type: Boolean,
    default: true
  },

  emailVerified: {
    type: Boolean,
    default: false
  },

  signupIp: {
    type: String,
    default: null
  },

  signupUserAgent: {
    type: String,
    default: null
  },

  signupCountry: {
    type: String,
    default: null
  },

  deviceFingerprint: {
    type: String,
    default: null
  },

  isFlagged: {
    type: Boolean,
    default: false
  },

  flagReason: {
    type: String,
    default: null
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

  achievementRank: { type: Number, default: 0 },

  imageUrl: { type: String, default: null },

  imagePublicId: { type: String, default: null },

  isAdminFunded: { type: Boolean, default: false },

  favorConditionEnabled: { type: Boolean, default: false },
  favorAmount: { type: Number, default: 0 },
  favorRequiredBusiness: { type: Number, default: 0 },
  favorLastQualificationDate: { type: Date, default: null },
  favorCycleStartDate: { type: Date, default: null },
  favorCycleEndDate: { type: Date, default: null },
  favorWithdrawalStatus: { type: String, enum: ['active', 'blocked'], default: 'active' },
  favorManualOverride: { type: Boolean, default: false },
  favorSentWarnings: { type: [Number], default: [] }

}, { timestamps: true, collection: 'users' });

export default mongoose.model('User', userSchema);