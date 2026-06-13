import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import UserInvestment from '../models/investment/user_investment.model.js';
import InvestmentPackage from '../models/investment/investment_package.model.js';
import User from '../models/auth/user.model.js';
import Wallet from '../models/finance/wallet.model.js';
import rewardEngine from '../utils/rewardEngine.js';
import investmentController from '../controllers/investment.controller.js';

dotenv.config();

// Override ROI_TEST_MODE to true so we can trigger payouts within 1 min
process.env.ROI_TEST_MODE = 'true';

async function test() {
  console.log('Connecting to database...');
  await connectDB();

  // Find a test user or create a temporary one
  let user = await User.findOne({ email: 'test_roi_user@example.com' });
  if (!user) {
    user = new User({
      email: 'test_roi_user@example.com',
      passwordHash: 'dummyhash',
      firstName: 'ROI',
      lastName: 'Tester',
      phoneNumber: '+923000000000',
      status: 'active'
    });
    await user.save();
  }

  // Find or create test wallet
  let wallet = await Wallet.findOne({ user: user._id });
  if (!wallet) {
    wallet = new Wallet({
      user: user._id,
      deposit: 1000,
      roi: 0
    });
    await wallet.save();
  } else {
    wallet.roi = 0;
    await wallet.save();
  }

  // Find a package to use
  let pkg = await InvestmentPackage.findOne({ isActive: true });
  if (!pkg) {
    pkg = new InvestmentPackage({
      name: 'Test Package',
      minAmount: 100,
      maxAmount: 1000,
      startRoi: 2.0,
      maxRoi: 3.5,
      durationMonths: 12,
      earlyWithdrawalPenaltyMonths: 2,
      earlyWithdrawalPenaltyPercent: 15,
      isActive: true
    });
    await pkg.save();
  }

  console.log(`Using user: ${user.email}, Package: ${pkg.name}`);

  // Clean up any old investments
  await UserInvestment.deleteMany({ user: user._id });

  // 1. Test Auto-Reinvest (autoReinvest = true)
  console.log('\n--- Test 1: Auto-Reinvest ON ---');
  const invReinvest = new UserInvestment({
    user: user._id,
    package: pkg._id,
    amount: 100,
    status: 'active',
    currentRoi: pkg.startRoi,
    lastPayoutAt: new Date(Date.now() - 70000), // set back > 60s
    createdAt: new Date(Date.now() - 70000),
    autoReinvest: true,
    roiClaimMode: 'auto'
  });
  await invReinvest.save();

  console.log(`Created investment with autoReinvest=true. Starting principal: $${invReinvest.amount}`);
  
  // Run daily payout job
  await rewardEngine.runDailyRoiPayout();

  // Fetch updated investment
  const updatedInvReinvest = await UserInvestment.findById(invReinvest._id);
  console.log(`Updated principal: $${updatedInvReinvest.amount}`);
  const expectedAmount = 100 + (100 * (pkg.startRoi / 100));
  if (Math.abs(updatedInvReinvest.amount - expectedAmount) < 0.001) {
    console.log('✅ Auto-reinvest principal compounded successfully!');
  } else {
    console.error(`❌ Expected $${expectedAmount}, got $${updatedInvReinvest.amount}`);
  }

  // 2. Test Manual Collect (autoReinvest = false)
  console.log('\n--- Test 2: Auto-Reinvest OFF (Manual Collect) ---');
  const invManual = new UserInvestment({
    user: user._id,
    package: pkg._id,
    amount: 200,
    status: 'active',
    currentRoi: pkg.startRoi,
    lastPayoutAt: new Date(Date.now() - 70000), // set back > 60s
    createdAt: new Date(Date.now() - 70000),
    autoReinvest: false,
    roiClaimMode: 'manual'
  });
  await invManual.save();

  console.log(`Created investment with autoReinvest=false. Principal: $${invManual.amount}`);

  // Run daily payout job
  await rewardEngine.runDailyRoiPayout();

  const updatedInvManual = await UserInvestment.findById(invManual._id);
  console.log(`Manual investment principal: $${updatedInvManual.amount} (should be unchanged: 200)`);
  console.log(`Pending ROI Claim: $${updatedInvManual.pendingRoiClaim}`);
  console.log(`Claim Expires At: ${updatedInvManual.claimExpiresAt}`);

  const expectedPayout = 200 * (pkg.startRoi / 100);
  if (updatedInvManual.amount === 200 && Math.abs(updatedInvManual.pendingRoiClaim - expectedPayout) < 0.001 && updatedInvManual.claimExpiresAt) {
    console.log('✅ Manual collect pending claim set successfully with expiration!');
  } else {
    console.error('❌ Manual collect pending claim configuration failed');
  }

  // Test claimDailyRoi endpoint simulation
  console.log('\n--- Test 3: Claiming ROI manual collection ---');
  // Mock req and res objects
  const req = {
    params: { id: invManual._id.toString() },
    user: { _id: user._id }
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      console.log('Response body:', JSON.stringify(body, null, 2));
    }
  };

  await investmentController.claimDailyRoi(req, res);

  const finalInvManual = await UserInvestment.findById(invManual._id);
  const finalWallet = await Wallet.findOne({ user: user._id });

  console.log(`Pending claim after collection: $${finalInvManual.pendingRoiClaim}`);
  console.log(`Wallet ROI balance after collection: $${finalWallet.roi}`);

  if (finalInvManual.pendingRoiClaim === 0 && Math.abs(finalWallet.roi - expectedPayout) < 0.001) {
    console.log('✅ ROI successfully claimed and credited to ROI wallet!');
  } else {
    console.error('❌ ROI claim failed');
  }

  // Clean up
  await UserInvestment.deleteMany({ user: user._id });
  await User.deleteOne({ _id: user._id });
  await Wallet.deleteOne({ user: user._id });

  console.log('\nAll tests completed. Exiting...');
  process.exit(0);
}

test().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
