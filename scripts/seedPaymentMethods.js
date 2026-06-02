import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PaymentMethod from '../models/finance/payment_method.model.js';

dotenv.config();

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    // Delete existing ones with same names
    await PaymentMethod.deleteMany({ name: { $in: ['PayFast PKR', 'CoinPayments USDT'] } });

    // Insert new payment methods
    const payfast = await PaymentMethod.create({
      name: 'PayFast PKR',
      type: 'fiat',
      currency: 'PKR',
      gateway: 'payfast',
      direction: 'deposit',
      instructions: 'Send your payment securely through PayFast checkout and enter the reference number.',
      accountDetails: {
        merchantId: process.env.PAYFAST_MERCHANT_ID || 'mock_merchant_123',
        merchantKey: process.env.PAYFAST_MERCHANT_KEY || 'mock_merchant_key_abc'
      },
      minDeposit: 500,
      isActive: true
    });

    const coinpayments = await PaymentMethod.create({
      name: 'CoinPayments USDT',
      type: 'crypto',
      currency: 'USDT',
      gateway: 'coinpayments',
      direction: 'deposit',
      instructions: 'Send USDT (TRC20) to the address provided on CoinPayments invoice screen.',
      accountDetails: {
        merchantId: process.env.COINPAYMENTS_MERCHANT_ID || 'mock_cp_merchant_999'
      },
      minDeposit: 10,
      isActive: true
    });

    console.log('✅ Successfully seeded PayFast & CoinPayments methods!');
    console.log('PayFast Method ID:', payfast._id);
    console.log('CoinPayments Method ID:', coinpayments._id);

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seed();
