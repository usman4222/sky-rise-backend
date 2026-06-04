import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/auth/user.model.js';
import Deposit from '../models/finance/deposit.model.js';
import PaymentMethod from '../models/finance/payment_method.model.js';

dotenv.config();

const main = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    // 1. Get first user
    const user = await User.findOne({});
    if (!user) {
      console.error('❌ No users found in database.');
      process.exit(1);
    }
    console.log(`👤 Using user: ${user.email} (${user._id})`);

    // 2. Get or create payment method
    let method = await PaymentMethod.findOne({ gateway: 'coinpayments' });
    if (!method) {
      method = await PaymentMethod.create({
        name: 'CoinPayments USDT Deposit',
        type: 'crypto',
        currency: 'USDT',
        gateway: 'coinpayments',
        direction: 'deposit',
        instructions: 'Send USDT (TRC20) via CoinPayments.',
        accountDetails: {
          currency: 'LTCT'
        },
        minDeposit: 10,
        isActive: true
      });
      console.log('💳 Created new CoinPayments payment method.');
    }

    // 3. Generate unique order ID
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const orderId = `USDT-${ts}-${rand}`;

    // 4. Create pending deposit
    const deposit = await Deposit.create({
      user: user._id,
      currency: 'USDT',
      amountPKR: null,
      amountUSDT: 50.0, // $50 deposit
      exchangeRate: null,
      paymentMethod: method._id,
      gateway: 'coinpayments',
      transactionId: orderId,
      status: 'pending',
      remarks: 'Awaiting CoinPayments LTCT payment'
    });

    console.log('✅ Created Pending Deposit:');
    console.log('  ID:', deposit._id.toString());
    console.log('  TransactionId (orderId):', deposit.transactionId);
    console.log('  Amount:', deposit.amountUSDT);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
