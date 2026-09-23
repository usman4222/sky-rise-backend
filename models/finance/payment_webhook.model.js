import mongoose from 'mongoose';

const paymentWebhookSchema = new mongoose.Schema({
  gateway: {
    type: String,
    required: true,
    index: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true, // Prevents duplicate webhook event processing (idempotency lock)
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['received', 'verified', 'error'],
    default: 'received',
    index: true
  },
  remarks: {
    type: String,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'payment_webhooks'
});

export default mongoose.model('PaymentWebhook', paymentWebhookSchema);
