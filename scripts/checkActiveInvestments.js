import mongoose from 'mongoose';
import dotenv from 'dotenv';
import UserInvestment from '../models/investment/user_investment.model.js';
import InvestmentPackage from '../models/investment/investment_package.model.js'; // Registers schema
import User from '../models/auth/user.model.js';

dotenv.config();

const main = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    const investments = await UserInvestment.find({}).populate('package');

    if (investments.length === 0) {
      console.log('❌ No UserInvestments found in the entire database.');
    } else {
      console.log(`✅ Found ${investments.length} total investments:`);
      for (let i = 0; i < investments.length; i++) {
        const inv = investments[i];
        const user = await User.findById(inv.user);
        console.log(`\n  [Investment #${i + 1}]`);
        console.log('    ID:', inv._id.toString());
        console.log('    User Email:', user ? user.email : 'Unknown User');
        console.log('    Package:', inv.package ? inv.package.name : 'No Package');
        console.log('    Amount:', inv.amount);
        console.log('    Status:', inv.status);
        console.log('    CreatedAt:', inv.createdAt);
        console.log('    LastPayoutAt:', inv.lastPayoutAt);
        console.log('    LastIncrementAt:', inv.lastIncrementAt);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
