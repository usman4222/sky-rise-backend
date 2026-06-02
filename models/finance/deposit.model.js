import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Currency of the deposit: PKR (manual PayFast) or USDT (CoinPayments / direct)
  currency: {
    type: String,
    enum: ['PKR', 'USDT'],
    required: true,
    default: 'PKR'
  },
  // PKR amount - null for direct USDT deposits
  amountPKR: {
    type: Number,
    default: null
  },
  // USDT amount - always populated (converted from PKR or direct)
  amountUSDT: {
    type: Number,
    required: true
  },
  // Exchange rate at time of deposit - null for direct USDT deposits
  exchangeRate: {
    type: Number,
    default: null
  },
  paymentMethod: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentMethod',
    required: true
  },
  // Gateway that processed this deposit: payfast | coinpayments | manual
  gateway: {
    type: String,
    enum: ['payfast', 'coinpayments', 'manual'],
    default: 'manual'
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  // Receipt screenshot URL (for manual / PayFast proof uploads)
  proofImageUrl: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  remarks: {
    type: String,
    default: ''
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'deposits'
});

export default mongoose.model('Deposit', depositSchema);
