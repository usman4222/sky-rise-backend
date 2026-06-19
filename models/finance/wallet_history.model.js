import mongoose from 'mongoose';

const walletHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    walletType: {
      type: String,
      enum: [
        'deposit',
        'adminAllocated',
        'freeRegBonus',
        'roi',
        'referral',
        'bonusActivation',
        'bonusTransferable',
        'bonusReceived',
        'salary',
        'achievement',
        'withdrawal'
      ],
      required: true,
      index: true
    },

    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
      index: true
    },

    amount: {
      type: Number,
      required: true,
      min: [0.0001, 'Amount must be positive']
    },

    previousBalance: {
      type: Number,
      required: true
    },

    newBalance: {
      type: Number,
      required: true
    },

    category: {
      type: String,
      required: true,
      index: true
    },

    description: {
      type: String,
      required: true
    },

    referenceModel: {
      type: String,
      default: null
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'wallet_history'
  }
);

const WalletHistory =
  mongoose.models.WalletHistory ||
  mongoose.model('WalletHistory', walletHistorySchema);

export default WalletHistory;