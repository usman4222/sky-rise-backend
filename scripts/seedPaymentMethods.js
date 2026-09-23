import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PaymentMethod from '../models/finance/payment_method.model.js';

dotenv.config();

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    // Delete existing gateway payment methods to re-seed clean
    await PaymentMethod.deleteMany({
      name: {
        $in: [
          'PayFast PKR',
          'PayFast PKR Deposit',
          'CoinPayments USDT',
          'CoinPayments USDT Deposit',
          'Manual PKR Withdrawal',
          'Manual USDT Withdrawal'
        ]
      }
    });

    // 1. PayFast PKR Deposit
    const payfast = await PaymentMethod.create({
      name: 'PayFast PKR Deposit',
      type: 'fiat',
      currency: 'PKR',
      gateway: 'payfast',
      direction: 'deposit',
      instructions: 'Pay securely through PayFast. You will be redirected to the PayFast checkout page.',
      accountDetails: {
        merchantId: process.env.PAYFAST_MERCHANT_ID || 'your_merchant_id'
      },
      minDeposit: 500,
      isActive: true
    });

    // 2. Manual PKR Withdrawal
    const pkrWithdrawal = await PaymentMethod.create({
      name: 'Manual PKR Withdrawal',
      type: 'fiat',
      currency: 'PKR',
      gateway: 'manual',
      direction: 'withdrawal',
      instructions: 'PKR withdrawal via Bank / Raast / JazzCash / Easypaisa. Admin processes manually.',
      accountDetails: {
        channels: ['bank', 'raast', 'jazzcash', 'easypaisa']
      },
      minDeposit: 10,
      isActive: true
    });

    // 3. CoinPayments USDT Deposit
    const coinpayments = await PaymentMethod.create({
      name: 'CoinPayments USDT Deposit',
      type: 'crypto',
      currency: 'USDT',
      gateway: 'coinpayments',
      direction: 'deposit',
      instructions: 'Send USDT (TRC20) via CoinPayments. You will receive a payment link.',
      accountDetails: {
        clientId: process.env.COINPAYMENTS_CLIENT_ID || 'your_client_id',
        currency: process.env.COINPAYMENTS_CURRENCY || 'USDT.TRC20'
      },
      minDeposit: 10,
      isActive: true
    });

    // 4. Manual USDT Withdrawal
    const usdtWithdrawal = await PaymentMethod.create({
      name: 'Manual USDT Withdrawal',
      type: 'crypto',
      currency: 'USDT',
      gateway: 'manual',
      direction: 'withdrawal',
      instructions: 'USDT TRC20 withdrawal. Admin sends USDT manually or via CoinPayments.',
      accountDetails: {
        channels: ['usdt_trc20', 'coinpayments']
      },
      minDeposit: 10,
      isActive: true
    });

    console.log('✅ Successfully seeded all 4 payment methods!');
    console.log('  PayFast PKR Deposit   ID:', payfast._id);
    console.log('  Manual PKR Withdrawal ID:', pkrWithdrawal._id);
    console.log('  CoinPayments USDT     ID:', coinpayments._id);
    console.log('  Manual USDT Withdrawal ID:', usdtWithdrawal._id);

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seed();

