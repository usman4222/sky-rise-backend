const mongoose = require('mongoose');

console.log('🔍 Starting local Mongoose Compile validation for all 42 schemas...');

try {
  // Group 1: Identity & RBAC
  const User = require('../models/auth/user.model');
  const LoginAccount = require('../models/auth/login_account.model');
  const LoginSession = require('../models/auth/login_session.model');
  const SecurityLog = require('../models/auth/security_log.model');
  const Role = require('../models/auth/role.model');
  const Permission = require('../models/auth/permission.model');
  const UserRole = require('../models/auth/user_role.model');
  const KycRecord = require('../models/auth/kyc_record.model');
  console.log('✅ Identity & RBAC Domain schemas compiled.');

  // Group 2: Network & Tree
  const ReferralTree = require('../models/network/referral_tree.model');
  const LevelUnlock = require('../models/network/level_unlock.model');
  const BusinessReport = require('../models/network/business_report.model');
  const LegReport = require('../models/network/leg_report.model');
  console.log('✅ Network & Tree Domain schemas compiled.');

  // Group 3: Wallets & Finance
  const Wallet = require('../models/finance/wallet.model');
  const WalletHistory = require('../models/finance/wallet_history.model');
  const Deposit = require('../models/finance/deposit.model');
  const PaymentMethod = require('../models/finance/payment_method.model');
  const PaymentWebhook = require('../models/finance/payment_webhook.model');
  const Withdrawal = require('../models/finance/withdrawal.model');
  const WithdrawalAccount = require('../models/finance/withdrawal_account.model');
  console.log('✅ Wallets & Finance Domain schemas compiled.');

  // Group 4: Investments & ROI
  const InvestmentPackage = require('../models/investment/investment_package.model');
  const UserInvestment = require('../models/investment/user_investment.model');
  const InvestmentPayment = require('../models/investment/investment_payment.model');
  const RoiHistory = require('../models/investment/roi_history.model');
  const CapitalWithdrawal = require('../models/investment/capital_withdrawal.model');
  const ExchangeRate = require('../models/investment/exchange_rate.model');
  console.log('✅ Investments & ROI Domain schemas compiled.');

  // Group 5: Rewards
  const EarningRule = require('../models/rewards/earning_rule.model');
  const DirectReferralIncome = require('../models/rewards/direct_referral_income.model');
  const TeamBonus = require('../models/rewards/team_bonus.model');
  const TeamBonusTransfer = require('../models/rewards/team_bonus_transfer.model');
  const LevelIncome = require('../models/rewards/level_income.model');
  const VipRank = require('../models/rewards/vip_rank.model');
  const VipQualification = require('../models/rewards/vip_qualification.model');
  const VipSalary = require('../models/rewards/vip_salary.model');
  const AchievementRank = require('../models/rewards/achievement_rank.model');
  const AchievementReward = require('../models/rewards/achievement_reward.model');
  console.log('✅ Rewards Domain schemas compiled.');

  // Group 6: System & Admin Logs
  const SystemSettings = require('../models/system/system_settings.model');
  const AdminLog = require('../models/system/admin_log.model');
  const BackgroundJob = require('../models/system/background_job.model');
  const Notification = require('../models/system/notification.model');
  const SupportTicket = require('../models/system/support_ticket.model');
  const Announcement = require('../models/system/announcement.model');
  const WebsitePage = require('../models/system/website_page.model');
  console.log('✅ System & Operations Domain schemas compiled.');

  console.log('\n🎉 SUCCESS! All 42 Mongoose schemas compile, import, and link perfectly!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ COMPILATION CRASHED:', error);
  process.exit(1);
}
