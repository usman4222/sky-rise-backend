import 'dotenv/config';
import connectDB from '../config/db.js';
import User from '../models/auth/user.model.js';
import admin from '../config/firebase.js';
import SecurityLog from '../models/auth/security_log.model.js';

async function run() {
  console.log('Connecting to database...');
  await connectDB();

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  console.log(`Scanning for users created since: ${twentyFourHoursAgo.toISOString()}`);

  const users = await User.find({ createdAt: { $gte: twentyFourHoursAgo } });
  console.log(`Found ${users.length} users registered in the last 24 hours.`);

  let suspendedCount = 0;

  for (const user of users) {
    let emailVerified = false;
    let checkReason = 'unverified';

    if (user.firebaseUid) {
      try {
        const userRecord = await admin.auth().getUser(user.firebaseUid);
        emailVerified = userRecord.emailVerified;
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          emailVerified = false;
          checkReason = 'firebase_user_not_found';
          console.log(`User ${user.email} not found in Firebase Auth.`);
        } else {
          console.error(`Error fetching Firebase user record for ${user.email}:`, err.message);
          continue; // skip to avoid false suspensions on network/API errors
        }
      }
    } else {
      emailVerified = false;
      checkReason = 'no_firebase_uid';
      console.log(`User ${user.email} has no Firebase UID synced.`);
    }

    if (!emailVerified) {
      console.log(`Suspending User: ${user.email} (Name: ${user.name}, IP: ${user.signupIp || 'N/A'}, Reason: ${checkReason})`);
      
      // Update blocking status
      user.isBlocked = true;
      user.status = "SUSPENDED_EMAIL_UNVERIFIED";
      user.canLogin = false;
      user.canDeposit = false;
      user.canInvest = false;
      user.canWithdraw = false;
      user.canEarnReferral = false;
      
      await user.save();
      suspendedCount++;

      // Create Security Log Entry
      await SecurityLog.create({
        user: user._id,
        event: 'EMERGENCY_SUSPEND_EMAIL_UNVERIFIED',
        description: `Emergency script suspended user. Email verification state: false (Reason: ${checkReason})`,
        ipAddress: '127.0.0.1',
        userAgent: 'emergency-suspend-script'
      });
    }
  }

  console.log(`\n--- Run Completed ---`);
  console.log(`Total users processed: ${users.length}`);
  console.log(`Suspended users count: ${suspendedCount}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error running emergency suspension script:', err);
  process.exit(1);
});
