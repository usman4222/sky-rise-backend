import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Import Models
import Permission from '../models/auth/permission.model.js';
import Role from '../models/auth/role.model.js';
import InvestmentPackage from '../models/investment/investment_package.model.js';
import VipRank from '../models/rewards/vip_rank.model.js';
import AchievementRank from '../models/rewards/achievement_rank.model.js';
import EarningRule from '../models/rewards/earning_rule.model.js';
import ExchangeRate from '../models/investment/exchange_rate.model.js';
import SystemSettings from '../models/system/system_settings.model.js';
import PaymentMethod from '../models/finance/payment_method.model.js';

dotenv.config();

// Database Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skyrise_future');
    console.log('🚀 Database connected for seeding...');
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    process.exit(1);
  }
};

const seedData = async () => {
  try {
    await connectDB();

    console.log('🧹 Cleaning existing seeder-driven dynamic collections (fresh start)...');
    await Permission.deleteMany({});
    await Role.deleteMany({});
    await InvestmentPackage.deleteMany({});
    await VipRank.deleteMany({});
    await AchievementRank.deleteMany({});
    await EarningRule.deleteMany({});
    await ExchangeRate.deleteMany({});
    await SystemSettings.deleteMany({});
    await PaymentMethod.deleteMany({});

    console.log('✅ Collections cleaned.');

    // 1. Seed Permissions
    console.log('🌱 Seeding Permissions...');
    const permissionsData = [
      { name: 'approve:deposits', description: 'Allows admin to review and approve/reject deposit slips' },
      { name: 'approve:withdrawals', description: 'Allows admin to review and process withdrawal requests' },
      { name: 'edit:packages', description: 'Allows admin to edit dynamic investment package values' },
      { name: 'manage:rewards', description: 'Allows admin to control weekly salaries or manual rank overrides' },
      { name: 'view:users', description: 'Allows support/auditors to search and view user tree details' },
      { name: 'manage:kyc', description: 'Allows support to approve or reject KYC documents' },
      { name: 'reply:support', description: 'Allows support staff to answer support tickets' }
    ];
    const seededPermissions = await Permission.insertMany(permissionsData);
    console.log(`- Seeded ${seededPermissions.length} Permissions.`);

    // 2. Seed Roles
    console.log('🌱 Seeding Roles...');
    const superAdminRole = new Role({
      name: 'SUPER_ADMIN',
      description: 'System owner. Full access to all modules and configurations.',
      permissions: seededPermissions.map(p => p._id) // All permissions
    });

    const financeAdminRole = new Role({
      name: 'FINANCE_ADMIN',
      description: 'Handles ledger bookkeeping, deposits approvals, and withdrawals.',
      permissions: seededPermissions
        .filter(p => ['approve:deposits', 'approve:withdrawals', 'view:users'].includes(p.name))
        .map(p => p._id)
    });

    const supportAdminRole = new Role({
      name: 'SUPPORT_ADMIN',
      description: 'Handles KYC validation, support ticket resolutions, and dashboard help.',
      permissions: seededPermissions
        .filter(p => ['view:users', 'manage:kyc', 'reply:support'].includes(p.name))
        .map(p => p._id)
    });

    const userRole = new Role({
      name: 'USER',
      description: 'Standard investor platform account. No admin panel rights.',
      permissions: [] // Standard user actions are route-protected, no explicit admin permission required
    });

    await superAdminRole.save();
    await financeAdminRole.save();
    await supportAdminRole.save();
    await userRole.save();
    console.log('- Seeded Roles: SUPER_ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, USER.');

    // 3. Seed Dynamic Packages (A, B, C, D, and hidden E)
    console.log('🌱 Seeding Dynamic Packages...');
    const packagesData = [
      {
        name: 'Package A — Basic Share Investment',
        minAmount: 10,
        maxAmount: 100,
        startRoi: 0.7,
        maxRoi: 1.2,
        roiIncrement: 0.1,
        roiIncrementDays: 10,
        autoReinvest: true,
        manualClaim: false,
        earlyWithdrawalPenaltyPercent: 15,
        earlyWithdrawalPenaltyMonths: 5,
        isHidden: false
      },
      {
        name: 'Package B — iPhone Share Investment',
        minAmount: 101,
        maxAmount: 500,
        startRoi: 0.8,
        maxRoi: 1.8,
        roiIncrement: 0.1,
        roiIncrementDays: 10,
        autoReinvest: true,
        manualClaim: false,
        earlyWithdrawalPenaltyPercent: 15,
        earlyWithdrawalPenaltyMonths: 5,
        isHidden: false
      },
      {
        name: 'Package C — Pepsi Share Investment',
        minAmount: 501,
        maxAmount: 1500,
        startRoi: 0.9,
        maxRoi: 2.0,
        roiIncrement: 0.1,
        roiIncrementDays: 10,
        autoReinvest: true,
        manualClaim: false,
        earlyWithdrawalPenaltyPercent: 15,
        earlyWithdrawalPenaltyMonths: 5,
        isHidden: false
      },
      {
        name: 'Package D — Coca-Cola Share Investment',
        minAmount: 1501,
        maxAmount: 9999999, // Represents Unlimited max boundary
        startRoi: 1.0,
        maxRoi: 2.5,
        roiIncrement: 0.1,
        roiIncrementDays: 10,
        autoReinvest: true,
        manualClaim: false,
        earlyWithdrawalPenaltyPercent: 15,
        earlyWithdrawalPenaltyMonths: 5,
        isHidden: false
      },
      {
        name: 'Package E — Hidden / Admin Development Package',
        minAmount: 10,
        maxAmount: 2000,
        startRoi: 1.0, // Fixed 1% daily
        maxRoi: 1.0,
        roiIncrement: 0.0,
        roiIncrementDays: 999,
        autoReinvest: true,
        manualClaim: false,
        earlyWithdrawalPenaltyPercent: 0, // No exit penalties
        earlyWithdrawalPenaltyMonths: 0,
        isHidden: true // Admin panel only, hidden from public
      }
    ];
    const seededPackages = await InvestmentPackage.insertMany(packagesData);
    console.log(`- Seeded ${seededPackages.length} Investment Packages (A, B, C, D, and hidden E).`);

    // 4. Seed VIP Rank Requirements (Weekly Salary Program)
    console.log('🌱 Seeding VIP Rank Criteria...');
    const vipRanksData = [
      { level: 1, name: 'VIP 1', requiredActiveLegs: 5, requiredBusinessPerLeg: 1000, weeklySalary: 50 },
      { level: 2, name: 'VIP 2', requiredActiveLegs: 5, requiredBusinessPerLeg: 2000, weeklySalary: 100 },
      { level: 3, name: 'VIP 3', requiredActiveLegs: 5, requiredBusinessPerLeg: 4000, weeklySalary: 200 },
      { level: 4, name: 'VIP 4', requiredActiveLegs: 5, requiredBusinessPerLeg: 8000, weeklySalary: 400 },
      { level: 5, name: 'VIP 5', requiredActiveLegs: 5, requiredBusinessPerLeg: 16000, weeklySalary: 800 }
    ];
    await VipRank.insertMany(vipRanksData);
    console.log('- Seeded 5 VIP Ranks (VIP 1 - VIP 5).');

    // 5. Seed Achievement Spark Milestones (Stages 1-10)
    console.log('🌱 Seeding Achievement Spark Milestones...');
    const achievementsData = [
      { stage: 1, name: 'Bronze Spark', requiredTeamBusiness: 2500, reward: 75 },
      { stage: 2, name: 'Silver Spark', requiredTeamBusiness: 5000, reward: 150 },
      { stage: 3, name: 'Golden Spark', requiredTeamBusiness: 10000, reward: 300 },
      { stage: 4, name: 'Platinum Spark', requiredTeamBusiness: 20000, reward: 600 },
      { stage: 5, name: 'Crystal Spark', requiredTeamBusiness: 40000, reward: 1200 },
      { stage: 6, name: 'Titanium Spark', requiredTeamBusiness: 80000, reward: 2400 },
      { stage: 7, name: 'Quantum Spark', requiredTeamBusiness: 160000, reward: 4800 },
      { stage: 8, name: 'Infinity Spark', requiredTeamBusiness: 320000, reward: 9600 },
      { stage: 9, name: 'Galactic Spark', requiredTeamBusiness: 640000, reward: 19200 },
      { stage: 10, name: 'Supreme Spark', requiredTeamBusiness: 1280000, reward: 38400 }
    ];
    await AchievementRank.insertMany(achievementsData);
    console.log('- Seeded 10 Achievement Spark Milestones ( Bronze up to Supreme ).');

    // 6. Seed Dynamic Earning Rules
    console.log('🌱 Seeding Global Earning Rules...');
    const earningRulesData = [
      {
        ruleName: 'free_reg_bonus_amount',
        value: 5,
        description: 'Instant non-withdrawable signup reward amount in dollars ($)'
      },
      {
        ruleName: 'team_bonus_per_member',
        value: 1,
        description: 'Team bonus earned in dollars for each member join within 5 levels'
      },
      {
        ruleName: 'team_bonus_validity_days',
        value: 10,
        description: 'Duration in days after signup during which user gets $1 team bonus joins'
      },
      {
        ruleName: 'team_bonus_max_levels',
        value: 5,
        description: 'Maximum depth level to receive the $1 team registration bonus'
      },
      {
        ruleName: 'max_bonus_investment_percent',
        value: 10,
        description: 'Maximum percentage of any investment that can be funded using bonus/transfer balance'
      },
      {
        ruleName: 'direct_referral_percent',
        value: 8,
        description: 'Commission percent earned on direct downline investments (calculated on real amount only)'
      },
      {
        ruleName: 'level_income_distribution',
        value: [8, 4, 4, 3, 2, 2, 2, 2, 2, 2],
        description: '10-level percentage distribution array of daily team ROI (Level 1 to Level 10)'
      },
      {
        ruleName: 'level_unlock_fee',
        value: 5,
        description: 'Activation fee in dollars required to unlock Level 2 to 10'
      },
      {
        ruleName: 'level_activation_bonus_usage_percent',
        value: 50,
        description: 'Maximum percentage of level unlock fee that can be paid using Level Activation Bonus wallet'
      }
    ];
    await EarningRule.insertMany(earningRulesData);
    console.log('- Seeded Earning Rules.');

    // 7. Seed baseline Exchange Rate
    console.log('🌱 Seeding baseline Exchange Rate...');
    const defaultRate = new ExchangeRate({
      rate: 278, // 1 USDT = 278 PKR
      updatedBy: null
    });
    await defaultRate.save();
    console.log('- Seeded default PKR/USDT exchange rate (1 USDT = 278 PKR).');

    // 8. Seed default System Settings
    console.log('🌱 Seeding baseline System Settings...');
    const defaultSettings = new SystemSettings({
      maintenanceMode: false,
      kycRequiredForWithdrawal: true,
      minWithdrawalAmount: 10,
      withdrawalFeePercent: 5,
      enabledModules: ['roi', 'referral', 'level_income', 'salary', 'achievements', 'transfers']
    });
    await defaultSettings.save();
    console.log('- Seeded default system settings.');

    // 9. Seed default Payment Methods
    console.log('🌱 Seeding baseline Payment Methods...');
    const paymentMethodsData = [
      {
        name: 'EasyPaisa',
        type: 'fiat',
        currency: 'PKR',
        accountDetails: { bank_name: 'EasyPaisa', account_title: 'SkyRise Future Ltd.', account_number: '03001234567' },
        minDeposit: 10,
        isActive: true
      },
      {
        name: 'JazzCash',
        type: 'fiat',
        currency: 'PKR',
        accountDetails: { bank_name: 'JazzCash', account_title: 'SkyRise Future Ltd.', account_number: '03107654321' },
        minDeposit: 10,
        isActive: true
      },
      {
        name: 'USDT TRC20 Wallet',
        type: 'crypto',
        currency: 'USDT',
        accountDetails: { wallet_address: 'TY5GpH37WdJkq9N21asLzPrVbCxqM1HqYt' },
        minDeposit: 10,
        isActive: true
      }
    ];
    await PaymentMethod.insertMany(paymentMethodsData);
    console.log('- Seeded default Payment Methods (EasyPaisa, JazzCash, USDT TRC20).');

    console.log('\n🌟 Database seeding completed successfully! All dynamic configs loaded.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seedData();
