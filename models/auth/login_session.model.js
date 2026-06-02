import mongoose from 'mongoose';

const loginSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true },
  ipAddress: { type: String, required: true },
  userAgent: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isRevoked: { type: Boolean, default: false, index: true }
}, { timestamps: true, collection: 'login_sessions' });

export default mongoose.model('LoginSession', loginSessionSchema);
