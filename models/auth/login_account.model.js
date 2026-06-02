import mongoose from 'mongoose';

const loginAccountSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, enum: ['email', 'phone', 'firebase', 'google'], required: true, default: 'email' },
  providerKey: { type: String, required: true, unique: true, trim: true, index: true },
  passwordHash: { type: String, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true, collection: 'login_accounts' });

export default mongoose.model('LoginAccount', loginAccountSchema);
