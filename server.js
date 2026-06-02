import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import connectDB from './config/db.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import networkRoutes from './routes/network.routes.js';
import firebaseAuthRoutes from './routes/firebaseAuth.routes.js';
import financeRoutes from './routes/finance.routes.js';
import investmentRoutes from './routes/investment.routes.js';
import adminRoutes from './routes/admin.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import rewardsRoutes from './routes/rewards.routes.js';
import supportRoutes from './routes/support.routes.js';

// Group 1: Identity & RBAC
import User from './models/auth/user.model.js';
import LoginAccount from './models/auth/login_account.model.js';
import LoginSession from './models/auth/login_session.model.js';
import SecurityLog from './models/auth/security_log.model.js';
import Role from './models/auth/role.model.js';
import Permission from './models/auth/permission.model.js';
import UserRole from './models/auth/user_role.model.js';
import KycRecord from './models/auth/kyc_record.model.js';

// Group 2: Network & Tree
import ReferralTree from './models/network/referral_tree.model.js';
import LevelUnlock from './models/network/level_unlock.model.js';
import BusinessReport from './models/network/business_report.model.js';
import LegReport from './models/network/leg_report.model.js';

// Group 3: Wallets & Finance
import Wallet from './models/finance/wallet.model.js';
import WalletHistory from './models/finance/wallet_history.model.js';
import Deposit from './models/finance/deposit.model.js';
import PaymentMethod from './models/finance/payment_method.model.js';
import PaymentWebhook from './models/finance/payment_webhook.model.js';
import Withdrawal from './models/finance/withdrawal.model.js';
import WithdrawalAccount from './models/finance/withdrawal_account.model.js';

// Group 4: Investments & ROI
import InvestmentPackage from './models/investment/investment_package.model.js';
import UserInvestment from './models/investment/user_investment.model.js';
import InvestmentPayment from './models/investment/investment_payment.model.js';
import RoiHistory from './models/investment/roi_history.model.js';
import CapitalWithdrawal from './models/investment/capital_withdrawal.model.js';
import ExchangeRate from './models/investment/exchange_rate.model.js';

// Group 5: Rewards
import EarningRule from './models/rewards/earning_rule.model.js';
import DirectReferralIncome from './models/rewards/direct_referral_income.model.js';
import TeamBonus from './models/rewards/team_bonus.model.js';
import TeamBonusTransfer from './models/rewards/team_bonus_transfer.model.js';
import LevelIncome from './models/rewards/level_income.model.js';
import VipRank from './models/rewards/vip_rank.model.js';
import VipQualification from './models/rewards/vip_qualification.model.js';
import VipSalary from './models/rewards/vip_salary.model.js';
import AchievementRank from './models/rewards/achievement_rank.model.js';
import AchievementReward from './models/rewards/achievement_reward.model.js';

// Group 6: System & Admin Logs
import SystemSettings from './models/system/system_settings.model.js';
import AdminLog from './models/system/admin_log.model.js';
import BackgroundJob from './models/system/background_job.model.js';
import Notification from './models/system/notification.model.js';
import SupportTicket from './models/system/support_ticket.model.js';
import Announcement from './models/system/announcement.model.js';
import WebsitePage from './models/system/website_page.model.js';


const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
  })
);

app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

connectDB();

const compiledModels = {
  identity_rbac_domain: {
    User,
    LoginAccount,
    LoginSession,
    SecurityLog,
    Role,
    Permission,
    UserRole,
    KycRecord
  },
  network_tree_domain: {
    ReferralTree,
    LevelUnlock,
    BusinessReport,
    LegReport
  },
  finance_wallets_domain: {
    Wallet,
    WalletHistory,
    Deposit,
    PaymentMethod,
    PaymentWebhook,
    Withdrawal,
    WithdrawalAccount
  },
  investments_roi_domain: {
    InvestmentPackage,
    UserInvestment,
    InvestmentPayment,
    RoiHistory,
    CapitalWithdrawal,
    ExchangeRate
  },
  commissions_rewards_domain: {
    EarningRule,
    DirectReferralIncome,
    TeamBonus,
    TeamBonusTransfer,
    LevelIncome,
    VipRank,
    VipQualification,
    VipSalary,
    AchievementRank,
    AchievementReward
  },
  system_ops_domain: {
    SystemSettings,
    AdminLog,
    BackgroundJob,
    Notification,
    SupportTicket,
    Announcement,
    WebsitePage
  }
};

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: '🚀 Welcome to the SkyRise Future Backend API Server.',
    version: '1.0.0'
  });
});

// Health Route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'UP & RUNNING',
    timestamp: new Date(),
    message: 'All enterprise-grade Mongoose models compiled and bound to MongoDB successfully!',
    compiledModels: {
      identity_rbac_domain: Object.keys(compiledModels.identity_rbac_domain),
      network_tree_domain: Object.keys(compiledModels.network_tree_domain),
      finance_wallets_domain: Object.keys(compiledModels.finance_wallets_domain),
      investments_roi_domain: Object.keys(compiledModels.investments_roi_domain),
      commissions_rewards_domain: Object.keys(compiledModels.commissions_rewards_domain),
      system_ops_domain: Object.keys(compiledModels.system_ops_domain)
    }
  });
});

// Real Auth Routes
app.use('/api/auth', authRoutes);

// Optional short auth routes
// This allows both:
// POST /api/auth/register
// POST /api/register
app.use('/api', authRoutes);
app.use('/api/firebase-auth', firebaseAuthRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/support', supportRoutes);

// Dedicated CoinPayments webhook endpoint (matches CoinPayments dashboard config)
import webhookController from './controllers/webhook.controller.js';
app.post('/api/coinpayments/webhook', webhookController.handleCoinPaymentsIPN);
// API Route List
app.get('/api/routes', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Available API routes',
    routes: [
      'GET  /',
      'GET  /api/health',
      'GET  /api/routes',

      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET  /api/auth/profile',
      'POST /api/auth/kyc',

      'POST /api/register',
      'POST /api/login',
      'POST /api/logout',
      'GET  /api/profile',
      'POST /api/kyc',

      'POST  /api/admin/payment-methods',
      'GET   /api/admin/payment-methods',
      'PUT   /api/admin/payment-methods/:id',
      'PATCH /api/admin/payment-methods/:id'
    ]
  });
});

// JSON 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    requestedPath: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      'GET  /',
      'GET  /api/health',
      'GET  /api/routes',

      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET  /api/auth/profile',
      'POST /api/auth/kyc',

      'POST /api/register',
      'POST /api/login',
      'POST /api/logout',
      'GET  /api/profile',
      'POST /api/kyc',

      'POST /api/firebase-auth/sync',
      'GET  /api/firebase-auth/me',

      'GET  /api/network/uplines',
      'GET  /api/network/downline',
      'POST /api/network/unlock-level',

      'GET  /api/finance/wallets',
      'GET  /api/finance/payment-methods',
      'POST /api/finance/deposit',
      'POST /api/finance/withdraw',
      'GET  /api/finance/history',

      'GET  /api/investments/packages',
      'POST /api/investments/purchase',
      'GET  /api/investments/my-investments',
      'POST /api/investments/withdraw-capital'
    ]
  });
});

// Global Error Handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);

  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `🚀 SkyRise Future Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
  );
});