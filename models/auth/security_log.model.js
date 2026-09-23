import mongoose from 'mongoose';

const securityLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // Can be null if the user does not exist (failed attempts)
    index: true
  },
  event: {
    type: String,
    required: true,
    index: true
  },
  description: {
    type: String,
    required: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'security_logs'
});

export default mongoose.model('SecurityLog', securityLogSchema);
