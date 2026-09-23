import mongoose from 'mongoose';

const paymentMethodSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true // e.g. "PayFast PKR", "CoinPayments USDT", "Manual Bank Transfer"
  },
  // fiat = PKR-based (PayFast, manual bank), crypto = USDT-based (CoinPayments, TRC20)
  type: {
    type: String,
    enum: ['fiat', 'crypto'],
    required: true
  },
  // The actual currency users deposit/withdraw in
  currency: {
    type: String,
    enum: ['PKR', 'USDT'],
    required: true,
    default: 'PKR'
  },
  // Payment gateway processor identifier
  gateway: {
    type: String,
    enum: ['payfast', 'coinpayments', 'manual'],
    required: true,
    default: 'manual'
  },
  // Deposit direction this method applies to
  direction: {
    type: String,
    enum: ['deposit', 'withdrawal', 'both'],
    default: 'deposit'
  },
  // Flexible config: account numbers, QR codes, wallet addresses, merchant IDs, etc.
  accountDetails: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Instructions shown to user on deposit screen (e.g. "Send payment to this account...")
  instructions: {
    type: String,
    default: ''
  },
  minDeposit: {
    type: Number,
    required: true,
    default: 10
  },
  maxDeposit: {
    type: Number,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'payment_methods'
});

export default mongoose.model('PaymentMethod', paymentMethodSchema);
