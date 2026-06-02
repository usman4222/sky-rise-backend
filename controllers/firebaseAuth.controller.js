import crypto from 'crypto';

import admin from '../config/firebase.js';
import User from '../models/auth/user.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import SecurityLog from '../models/auth/security_log.model.js';
import Role from '../models/auth/role.model.js';
import UserRole from '../models/auth/user_role.model.js';

import { sendError, successResponse } from '../utils/response.js';

const generateReferralCode = async () => {
    let referralCode;
    let exists = true;

    while (exists) {
        const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
        referralCode = `SF${rand}`;
        exists = await User.findOne({ referralCode });
    }

    return referralCode;
};

const ensureUserRole = async (userId) => {
    const userRole = await Role.findOneAndUpdate(
        { name: 'USER' },
        {
            name: 'USER',
            description: 'Default normal user role',
            permissions: []
        },
        {
            upsert: true,
            returnDocument: 'after'
        }
    );

    await UserRole.findOneAndUpdate(
        {
            user: userId,
            role: userRole._id
        },
        {
            user: userId,
            role: userRole._id
        },
        {
            upsert: true,
            returnDocument: 'after'
        }
    );

    return userRole;
};

const buildFirebaseUserResponse = async (user) => {
    const wallet = await Wallet.findOne({ user: user._id });

    const userRoles = await UserRole.find({ user: user._id }).populate('role');

    const roles = userRoles
        .map((item) => item.role?.name)
        .filter(Boolean);

    const signupBonusHistory = await WalletHistory.findOne({
        user: user._id,
        category: 'free_reg_bonus'
    });

    const signupBonusAmount =
        signupBonusHistory?.amount || wallet?.bonusReceived || 0;

    return {
        id: user._id,
        firebaseUid: user.firebaseUid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referralCode,
        sponsor: user.sponsor,
        kycStatus: user.kycStatus,
        status: user.status,
        unlockedLevels: user.unlockedLevels || [1],
        vipRank: user.vipRank || 0,
        achievementRank: user.achievementRank || 0,

        role: roles[0] || 'USER',
        roles: roles.length ? roles : ['USER'],

        signupBonus: {
            credited: signupBonusAmount > 0,
            amount: signupBonusAmount,
            walletType: 'bonusReceived',
            message:
                signupBonusAmount > 0
                    ? `You received $${signupBonusAmount} signup bonus.`
                    : 'No signup bonus found.'
        },

        wallets: {
            deposit: wallet?.deposit || 0,
            roi: wallet?.roi || 0,
            referral: wallet?.referral || 0,
            bonusActivation: wallet?.bonusActivation || 0,
            bonusTransferable: wallet?.bonusTransferable || 0,
            bonusReceived: wallet?.bonusReceived || 0,
            salary: wallet?.salary || 0,
            achievement: wallet?.achievement || 0,
            withdrawal: wallet?.withdrawal || 0
        }
    };
};

export const syncFirebaseUser = async (req, res) => {
    try {
        const { idToken, name, phone, sponsorCode } = req.body;

        if (!idToken) {
            return sendError(res, 'Firebase ID token is required', 400);
        }

        const decodedToken = await admin.auth().verifyIdToken(idToken);

        const firebaseUid = decodedToken.uid;
        const email = decodedToken.email;

        if (!email) {
            return sendError(res, 'Firebase account email is required', 400);
        }

        let existingUser = await User.findOne({ firebaseUid });

        if (existingUser) {
            await ensureUserRole(existingUser._id);

            const userPayload = await buildFirebaseUserResponse(existingUser);

            return successResponse(res, 'Firebase user already synced', {
                user: userPayload
            });
        }

        const emailExists = await User.findOne({ email });

        if (emailExists) {
            emailExists.firebaseUid = firebaseUid;
            await emailExists.save();

            await ensureUserRole(emailExists._id);

            const userPayload = await buildFirebaseUserResponse(emailExists);

            return successResponse(res, 'Firebase account linked with existing MongoDB user', {
                user: userPayload
            });
        }

        let sponsorUser = null;
        let uplineAncestors = [];

        if (sponsorCode) {
            sponsorUser = await User.findOne({ referralCode: sponsorCode.trim() });

            if (!sponsorUser) {
                return sendError(res, 'Invalid sponsor referral code', 400);
            }

            const sponsorNode = await ReferralTree.findOne({ user: sponsorUser._id });

            if (sponsorNode) {
                uplineAncestors = [sponsorUser._id, ...sponsorNode.ancestors];
            } else {
                uplineAncestors = [sponsorUser._id];
            }
        }

        const referralCode = await generateReferralCode();

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 10);

        const user = await User.create({
            firebaseUid,
            name: name || decodedToken.name || email.split('@')[0],
            email,
            phone: phone || '',
            sponsor: sponsorUser ? sponsorUser._id : null,
            referralCode,
            status: 'active',
            kycStatus: 'unsubmitted',
            teamBonusDeadline: deadline
        });

        await ensureUserRole(user._id);

        await ReferralTree.create({
            user: user._id,
            referredBy: sponsorUser ? sponsorUser._id : null,
            ancestors: uplineAncestors
        });

        if (sponsorUser) {
            await ReferralTree.findOneAndUpdate(
                { user: sponsorUser._id },
                { $inc: { directReferralsCount: 1 } }
            );

            await ReferralTree.updateMany(
                { user: { $in: uplineAncestors } },
                { $inc: { teamSize: 1 } }
            );
        }

        await Wallet.create({
            user: user._id,
            deposit: 0,
            roi: 0,
            referral: 0,
            bonusActivation: 0,
            bonusTransferable: 0,
            bonusReceived: 5,
            salary: 0,
            achievement: 0,
            withdrawal: 0
        });

        await WalletHistory.create({
            user: user._id,
            walletType: 'bonusReceived',
            type: 'credit',
            amount: 5,
            previousBalance: 0,
            newBalance: 5,
            category: 'free_reg_bonus',
            description: 'Welcome promotional signup credit. Valid for first investment merge only.'
        });

        await SecurityLog.create({
            user: user._id,
            event: 'FIREBASE_USER_SYNCED',
            description: `Firebase account synced for email: ${email}`,
            ipAddress: req.ip || '127.0.0.1',
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        const userPayload = await buildFirebaseUserResponse(user);

        return successResponse(
            res,
            'Firebase user synced successfully. Welcome bonus credited.',
            {
                user: userPayload
            },
            201
        );
    } catch (error) {
        console.error('Firebase sync error:', error);

        return sendError(res, 'Firebase sync failed', 500, error);
    }
};

export const getFirebaseProfile = async (req, res) => {
    try {
        const user = req.user;

        const wallet = await Wallet.findOne({ user: user._id });

        const userRoles = await UserRole.find({ user: user._id }).populate('role');

        const roles = userRoles
            .map((item) => item.role?.name)
            .filter(Boolean);

        const signupBonusHistory = await WalletHistory.findOne({
            user: user._id,
            category: 'free_reg_bonus'
        });

        const signupBonusAmount =
            signupBonusHistory?.amount || wallet?.bonusReceived || 0;

        return successResponse(res, 'Firebase protected profile fetched successfully', {
            user: {
                id: user._id,
                firebaseUid: user.firebaseUid,
                name: user.name,
                email: user.email,
                phone: user.phone,
                referralCode: user.referralCode,
                sponsor: user.sponsor,
                kycStatus: user.kycStatus,
                status: user.status,
                unlockedLevels: user.unlockedLevels || [1],
                vipRank: user.vipRank || 0,
                achievementRank: user.achievementRank || 0,

                role: roles[0] || 'USER',
                roles: roles.length ? roles : ['USER'],

                signupBonus: {
                    credited: signupBonusAmount > 0,
                    amount: signupBonusAmount,
                    walletType: 'bonusReceived',
                    message:
                        signupBonusAmount > 0
                            ? `You received $${signupBonusAmount} signup bonus.`
                            : 'No signup bonus found.'
                },

                wallets: {
                    deposit: wallet?.deposit || 0,
                    roi: wallet?.roi || 0,
                    referral: wallet?.referral || 0,
                    bonusActivation: wallet?.bonusActivation || 0,
                    bonusTransferable: wallet?.bonusTransferable || 0,
                    bonusReceived: wallet?.bonusReceived || 0,
                    salary: wallet?.salary || 0,
                    achievement: wallet?.achievement || 0,
                    withdrawal: wallet?.withdrawal || 0
                }
            }
        });
    } catch (error) {
        console.error('Firebase profile error:', error);

        return sendError(res, 'Failed to fetch Firebase user profile', 500, error);
    }
};

export const updateFirebasePassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        const user = req.user;

        if (!newPassword || newPassword.length < 6) {
            return sendError(res, 'Password must be at least 6 characters long', 400);
        }

        // 1. Force update the password in Firebase Auth using the Admin SDK
        await admin.auth().updateUser(user.firebaseUid, {
            password: newPassword
        });

        // 2. Fallback: Update local MongoDB LoginAccount if it exists (legacy fallback)
        const LoginAccount = (await import('../models/auth/login_account.model.js')).default;
        const bcrypt = (await import('bcryptjs')).default;
        
        const localAccount = await LoginAccount.findOne({ user: user._id });
        if (localAccount) {
            const salt = await bcrypt.genSalt(10);
            localAccount.passwordHash = await bcrypt.hash(newPassword, salt);
            await localAccount.save();
        }

        // 3. Log the security event
        await SecurityLog.create({
            user: user._id,
            event: 'PASSWORD_UPDATED',
            description: 'Password was updated successfully via Profile',
            ipAddress: req.ip || '127.0.0.1',
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        return successResponse(res, 'Password updated successfully across all systems');
    } catch (error) {
        console.error('Password update error:', error);
        return sendError(res, 'Failed to update password. Make sure it meets Firebase requirements.', 500, error);
    }
};