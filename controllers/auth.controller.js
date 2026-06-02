import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Models
import User from '../models/auth/user.model.js';
import LoginAccount from '../models/auth/login_account.model.js';
import LoginSession from '../models/auth/login_session.model.js';
import SecurityLog from '../models/auth/security_log.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import KycRecord from '../models/auth/kyc_record.model.js';
import Role from '../models/auth/role.model.js';
import UserRole from '../models/auth/user_role.model.js';
import EarningRule from '../models/rewards/earning_rule.model.js';

// Reward triggers
import rewardEngine from '../utils/rewardEngine.js';
const { payoutTeamBonusJoin } = rewardEngine;

// Response helpers
import { sendError, successResponse } from '../utils/response.js';

// Helper to generate JWT
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'skyrise_future_super_secure_jwt_token_key_2026', {
    expiresIn: '7d'
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { name, email, phone, password, sponsorCode } = req.body;

    if (!name || !email || !phone || !password) {
      return sendError(res, 'All profile fields are required', 400);
    }

    // Check if email already registered
    const userExists = await User.findOne({ email });
    if (userExists) {
      return sendError(res, 'Email address already registered', 400);
    }

    let sponsorUser = null;
    let uplineAncestors = [];

    // Find sponsor by referralCode
    if (sponsorCode) {
      sponsorUser = await User.findOne({ referralCode: sponsorCode.trim() });
      if (!sponsorUser) {
        return sendError(res, 'Invalid sponsor referral code', 400);
      }

      // Fetch sponsor referral tree entry to map ancestors list
      const sponsorNode = await ReferralTree.findOne({ user: sponsorUser._id });
      if (sponsorNode) {
        // Materialized Ancestry list: direct parent sponsor is at index 0
        uplineAncestors = [sponsorUser._id, ...sponsorNode.ancestors];
      }
    }

    // Generate unique referral code for the new user
    let referralCode;
    let codeExists = true;
    while (codeExists) {
      const rand = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
      referralCode = `SF${rand}`;
      const existingCode = await User.findOne({ referralCode });
      if (!existingCode) codeExists = false;
    }

    // 1. Create User Profile
    const user = new User({
      name,
      email,
      phone,
      sponsor: sponsorUser ? sponsorUser._id : null,
      referralCode,
      status: 'active',
      kycStatus: 'unsubmitted'
    });

    // Calculate dynamic team bonus deadline (Signup date + 10 days)
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 10);
    user.teamBonusDeadline = deadline;

    await user.save();

    // 2. Hash Password and Create Login Account
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const loginAccount = new LoginAccount({
      user: user._id,
      provider: 'email',
      providerKey: email,
      passwordHash
    });
    await loginAccount.save();

    // Associate default 'USER' role
    const userRoleObj = await Role.findOne({ name: 'USER' });
    if (userRoleObj) {
      await UserRole.create({
        user: user._id,
        role: userRoleObj._id
      });
    }

    // 3. Create Referral Tree record
    const referralNode = new ReferralTree({
      user: user._id,
      referredBy: sponsorUser ? sponsorUser._id : null,
      ancestors: uplineAncestors
    });
    await referralNode.save();

    // Increment sponsor direct referrals counts
    if (sponsorUser) {
      await ReferralTree.findOneAndUpdate(
        { user: sponsorUser._id },
        { $inc: { directReferralsCount: 1 } }
      );

      // Increment team size for all uplines
      await ReferralTree.updateMany(
        { user: { $in: uplineAncestors } },
        { $inc: { teamSize: 1 } }
      );
    }

    // 4. Create User Wallets & seed $5 signup bonus
    const regBonusRule = await EarningRule.findOne({ ruleName: 'free_reg_bonus_amount' });
    const signupBonus = regBonusRule ? Number(regBonusRule.value) : 5;

    const wallet = new Wallet({
      user: user._id,
      freeRegBonus: signupBonus // $5 non-withdrawable promotional credit
    });
    await wallet.save();

    // Log credit inside WalletHistory
    await WalletHistory.create({
      user: user._id,
      walletType: 'freeRegBonus',
      type: 'credit',
      amount: signupBonus,
      previousBalance: 0,
      newBalance: signupBonus,
      category: 'free_reg_bonus',
      description: `Welcome Promotional Sign-up Credit. Valid for first investment merge only.`
    });

    // 5. Trigger $1 Team Joins bonus calculations for active uplines (5 levels)
    if (sponsorUser) {
      await payoutTeamBonusJoin(user._id);
    }

    // Log Security Entry
    await SecurityLog.create({
      user: user._id,
      event: 'USER_REGISTERED',
      description: `Successfully created local account profile via email: ${email}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Auto Login Session
    const token = generateToken(user._id);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days session

    const session = new LoginSession({
      user: user._id,
      token,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown',
      expiresAt
    });
    await session.save();

    return successResponse(res, 'Signup successful! Welcome bonus of $5 credited.', {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        referralCode: user.referralCode,
        sponsor: user.sponsor,
        kycStatus: user.kycStatus
      }
    }, 201);
  } catch (error) {
    console.error('Registration API error:', error);
    return sendError(res, 'Internal signup error', 500, error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 'Email and password are required', 400);
    }

    // Find Auth Account
    const authAccount = await LoginAccount.findOne({ providerKey: email.trim().toLowerCase(), isActive: true });
    if (!authAccount) {
      // Log failed security entry
      await SecurityLog.create({
        event: 'LOGIN_FAILED',
        description: `Invalid credential login attempt on email: ${email}`,
        ipAddress: req.ip || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'unknown'
      });
      return sendError(res, 'Invalid credentials', 401);
    }

    // Verify hashed password
    const isMatch = await bcrypt.compare(password, authAccount.passwordHash);
    if (!isMatch) {
      await SecurityLog.create({
        user: authAccount.user,
        event: 'LOGIN_FAILED',
        description: `Incorrect password entered for account email: ${email}`,
        ipAddress: req.ip || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'unknown'
      });
      return sendError(res, 'Invalid credentials', 401);
    }

    // Find User Profile
    const user = await User.findById(authAccount.user);
    if (!user) {
      return sendError(res, 'Associated profile not found', 404);
    }

    if (user.status === 'suspended') {
      return sendError(res, 'Your account is suspended. Contact Support.', 403);
    }

    // Generate Session JWT
    const token = generateToken(user._id);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const session = new LoginSession({
      user: user._id,
      token,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown',
      expiresAt
    });
    await session.save();

    // Log security access
    await SecurityLog.create({
      user: user._id,
      event: 'LOGIN_SUCCESS',
      description: `User session successfully opened via email: ${email}`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Check user role
    const userRoles = await UserRole.find({ user: user._id }).populate('role');
    const roles = userRoles.map(ur => ur.role.name);

    return successResponse(res, 'Login successful!', {
      token,
      roles,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        referralCode: user.referralCode,
        kycStatus: user.kycStatus
      }
    });
  } catch (error) {
    console.error('Login API error:', error);
    return sendError(res, 'Internal login error', 500, error);
  }
};

// @desc    Logout user (Revokes session)
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res) => {
  try {
    // Revoke current session
    await LoginSession.findOneAndUpdate({ token: req.token }, { isRevoked: true });

    await SecurityLog.create({
      user: req.user._id,
      event: 'LOGOUT_SUCCESS',
      description: `Active session terminated successfully`,
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    return successResponse(res, 'Logged out successfully');
  } catch (error) {
    console.error('Logout API error:', error);
    return sendError(res, 'Internal logout error', 500);
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    const user = req.user;

    // Fetch wallet balances
    const wallet = await Wallet.findOne({ user: user._id });

    // Fetch sponsor details
    let sponsorName = 'N/A';
    if (user.sponsor) {
      const sponsor = await User.findById(user.sponsor);
      if (sponsor) sponsorName = sponsor.name;
    }

    // Fetch user roles
    const userRoles = await UserRole.find({ user: user._id }).populate('role');
    const roles = userRoles.map(ur => ur.role.name);

    return successResponse(res, 'Profile retrieved successfully', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referralCode,
        sponsorName,
        kycStatus: user.kycStatus,
        status: user.status,
        teamBonusDeadline: user.teamBonusDeadline,
        vipRank: user.vipRank,
        achievementRank: user.achievementRank,
        roles,
        wallets: wallet || {}
      }
    });
  } catch (error) {
    console.error('Profile API error:', error);
    return sendError(res, 'Internal profile error', 500);
  }
};

// @desc    Submit KYC Document details
// @route   POST /api/auth/kyc
// @access  Private
const submitKyc = async (req, res) => {
  try {
    const { documentType, documentNumber, documentFrontUrl, documentBackUrl } = req.body;

    if (!documentType || !documentNumber || !documentFrontUrl) {
      return sendError(res, 'Required KYC document details are missing', 400);
    }

    // Update profile kycStatus to pending
    await User.findByIdAndUpdate(req.user._id, { kycStatus: 'pending' });

    // Upsert KycRecord
    await KycRecord.findOneAndUpdate(
      { user: req.user._id },
      {
        documentType,
        documentNumber,
        documentFrontUrl,
        documentBackUrl: documentBackUrl || null,
        status: 'pending',
        remarks: 'Verification under review by security compliance'
      },
      { upsert: true, returnDocument: 'after' }
    );

    return successResponse(res, 'KYC documents submitted successfully! Under review.');
  } catch (error) {
    console.error('KYC submission error:', error);
    return sendError(res, 'Internal KYC submission error', 500);
  }
};

export default {
  register,
  login,
  logout,
  getProfile,
  submitKyc
};
