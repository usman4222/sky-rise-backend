import mongoose from 'mongoose';
import crypto from 'crypto';

// Load encryption key from environment (must be 32 bytes/characters)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'skyrise_future_32_bytes_enc_key_!';
const IV_LENGTH = 16; // For AES, this is always 16

// Helper encryption functions
const keyBuffer = Buffer.alloc(32, ENCRYPTION_KEY);

function encrypt(text) {
  if (!text) return text;
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  let textParts = text.split(':');
  let iv = Buffer.from(textParts.shift(), 'hex');
  let encryptedText = Buffer.from(textParts.join(':'), 'hex');
  let decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

const withdrawalAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true // e.g. "My JazzCash", "Personal USDT TRC20", "HBL Savings"
  },
  // Withdrawal channel / method
  channel: {
    type: String,
    enum: ['bank', 'raast', 'jazzcash', 'easypaisa', 'usdt_trc20', 'coinpayments'],
    required: true
  },
  accountTitle: {
    type: String,
    required: true,
    trim: true // Account holder's full name
  },
  // Sensitive field: encrypted when saved, decrypted when fetched
  // Stores: mobile number (jazzcash/easypaisa), IBAN (bank/raast), USDT wallet address, CoinPayments address
  accountNumber: {
    type: String,
    required: true,
    trim: true,
    get: decrypt,
    set: encrypt
  },
  // Optional: USDT TRC20 or CoinPayments wallet address (stored encrypted)
  walletAddress: {
    type: String,
    default: null,
    trim: true,
    get: (val) => (val ? decrypt(val) : val),
    set: (val) => (val ? encrypt(val) : val)
  },
  // Raast ID (unique 13-digit national ID or IBAN linked Raast ID)
  raastId: {
    type: String,
    default: null,
    trim: true
  },
  // Bank / Raast extra details: bankName, branchCode, iban, swiftCode, etc.
  bankDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'withdrawal_accounts',
  toJSON: { getters: true }, // Ensure getters run on parsing to JSON
  toObject: { getters: true }
});

export default mongoose.model('WithdrawalAccount', withdrawalAccountSchema);
