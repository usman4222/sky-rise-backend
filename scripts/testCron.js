import 'dotenv/config';
import connectDB from '../config/db.js';
import rewardEngine from '../utils/rewardEngine.js';

const { runDailyRoiPayout } = rewardEngine;

async function test() {
  console.log('Connecting to database...');
  await connectDB();
  console.log('Starting daily ROI payout simulation...');
  await runDailyRoiPayout();
  console.log('Daily ROI payout simulation completed. Exiting...');
  process.exit(0);
}

test().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
