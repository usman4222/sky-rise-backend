import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Deposit from '../models/finance/deposit.model.js';

dotenv.config();

const main = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    const lastPending = await Deposit.findOne({ currency: 'USDT', status: 'pending' }).sort({ createdAt: -1 });

    if (lastPending) {
      console.log('✅ Found Last Pending Deposit:');
      console.log('  ID:', lastPending._id.toString());
      console.log('  TransactionId (orderId):', lastPending.transactionId);
      console.log('  Amount:', lastPending.amountUSDT);
      console.log('  Status:', lastPending.status);
    } else {
      console.log('❌ No pending USDT deposits found.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
