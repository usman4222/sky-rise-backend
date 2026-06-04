import mongoose from 'mongoose';

const userPaymentMethodSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  methodType: {
    type: String,
    enum: ['bank', 'raast', 'jazzcash', 'easypaisa', 'usdt_trc20'],
    required: true
  },
  accountTitle: {
    type: String,
    required: true,
    trim: true
  },
  accountNumber: {
    type: String,
    required: true,
    trim: true
  },
  walletAddress: {
    type: String,
    default: null,
    trim: true
  },
  bankName: {
    type: String,
    default: null,
    trim: true
  },
  iban: {
    type: String,
    default: null,
    trim: true
  },
  phoneNumber: {
    type: String,
    default: null,
    trim: true
  },
  network: {
    type: String,
    default: 'TRC20',
    trim: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true,
  collection: 'user_payment_methods'
});

export default mongoose.model('UserPaymentMethod', userPaymentMethodSchema);
