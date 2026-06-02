import mongoose from 'mongoose';

const exchangeRateSchema = new mongoose.Schema({
  rate: {
    type: Number,
    required: true,
    default: 278 // Default exchange rate: 1 USDT = 278 PKR
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  collection: 'exchange_rates'
});

export default mongoose.model('ExchangeRate', exchangeRateSchema);
