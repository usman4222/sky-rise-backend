import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/auth/user.model.js';
import Deposit from '../models/finance/deposit.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import PaymentWebhook from '../models/finance/payment_webhook.model.js';

dotenv.config();

const main = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    const transactionId = 'USDT-MPXZ6H39-B3UC';

    // 1. Fetch deposit
    const deposit = await Deposit.findOne({ transactionId });
    if (!deposit) {
      console.error('❌ Deposit not found!');
      process.exit(1);
    }
    console.log('\n--- Deposit Record ---');
    console.log('  TransactionId:', deposit.transactionId);
    console.log('  Gateway Tx ID:', deposit.gatewayTransactionId);
    console.log('  Amount:', deposit.amountUSDT);
    console.log('  Status:', deposit.status);
    console.log('  Remarks:', deposit.remarks);

    // 2. Fetch Wallet
    const wallet = await Wallet.findOne({ user: deposit.user });
    console.log('\n--- User Wallet ---');
    console.log('  Deposit Balance:', wallet ? wallet.deposit : 'No Wallet Found');

    // 3. Fetch Wallet History
    const history = await WalletHistory.find({ user: deposit.user }).sort({ createdAt: -1 }).limit(3);
    console.log('\n--- Recent Wallet History ---');
    history.forEach(h => {
      console.log(`  [${h.type.toUpperCase()}] $${h.amount} -> New Bal: $${h.newBalance} | Cat: ${h.category} | Desc: ${h.description}`);
    });

    // 4. Fetch Webhook Log
    const webhook = await PaymentWebhook.findOne({ transactionId: deposit.gatewayTransactionId });
    console.log('\n--- Webhook Record ---');
    if (webhook) {
      console.log('  Gateway:', webhook.gateway);
      console.log('  TransactionId:', webhook.transactionId);
      console.log('  Status:', webhook.status);
      console.log('  Remarks:', webhook.remarks);
    } else {
      console.log('  ❌ Webhook record not found!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
