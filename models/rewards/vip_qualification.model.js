import mongoose from 'mongoose';

const vipQualificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  currentRank: {
    type: Number,
    default: 0 // 0 = None, 1 = VIP 1, 2 = VIP 2, etc.
  },
  activeLegsCount: {
    type: Number,
    default: 0 // Direct legs currently active
  },
  qualifiedLegsDetails: [{
    legUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    volume: { type: Number, default: 0 }
  }],
  status: {
    type: String,
    enum: ['active', 'suspended', 'none'],
    default: 'none'
  },
  qualifiedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'vip_qualifications'
});

export default mongoose.model('VipQualification', vipQualificationSchema);
