import mongoose from 'mongoose';
import dotenv from 'dotenv';
import financeController from '../controllers/finance.controller.js';
import User from '../models/auth/user.model.js';

dotenv.config();

const { getLedgerHistory } = financeController;

const main = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🚀 Connected to MongoDB...');

    const user = await User.findOne({});
    if (!user) {
      console.error('❌ No users found.');
      process.exit(1);
    }

    // Mock Express req & res
    const req = {
      user: {
        _id: user._id
      }
    };

    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        console.log('\n📥 Response Status:', this.statusCode || 200);
        console.log('📥 Response JSON structure:');
        console.log(JSON.stringify(data, null, 2).substring(0, 1000)); // print first 1000 chars
        process.exit(0);
      }
    };

    await getLedgerHistory(req, res);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

main();
