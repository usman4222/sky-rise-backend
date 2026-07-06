import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import admin from '../config/firebase.js';
import User from '../models/auth/user.model.js';
import { isDisposableEmail } from '../utils/emailFilter.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import ReferralTree from '../models/network/referral_tree.model.js';
import SecurityLog from '../models/auth/security_log.model.js';
import Role from '../models/auth/role.model.js';
import UserRole from '../models/auth/user_role.model.js';
import Otp from '../models/auth/otp.model.js';
import twilio from 'twilio';

const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const serviceSid = process.env.TWILIO_SERVICE_SID;
    if (accountSid && authToken && serviceSid) {
        return {
            client: twilio(accountSid, authToken, { lazyLoading: true }),
            serviceSid
        };
    }
    return null;
};

const formatE164Phone = (phone) => {
    let formatted = phone.trim();
    if (!formatted.startsWith('+')) {
        if (formatted.startsWith('92') || formatted.startsWith('91') || formatted.startsWith('44')) {
            formatted = '+' + formatted;
        } else if (formatted.startsWith('0')) {
            formatted = '+92' + formatted.slice(1);
        } else {
            formatted = '+' + formatted;
        }
    }
    return formatted;
};




import { sendError, successResponse } from '../utils/response.js';
import rewardEngine from '../utils/rewardEngine.js';
const { payoutTeamBonusJoin } = rewardEngine;

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

const buildFirebaseUserResponse = async (user, emailVerified = false) => {
    // Sync favor condition status first
    const { syncFavorConditionStatus, calculateQualifyingBusiness } = await import('../services/favor.service.js');
    user = await syncFavorConditionStatus(user);

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

    const achievedBusiness = user.favorConditionEnabled
      ? await calculateQualifyingBusiness(user._id, user.favorCycleStartDate, user.favorCycleEndDate)
      : 0;

    const remainingBusiness = user.favorConditionEnabled
      ? Math.max(0, user.favorRequiredBusiness - achievedBusiness)
      : 0;

    const progressPercent = user.favorConditionEnabled && user.favorRequiredBusiness > 0
      ? Math.min(100, Math.round((achievedBusiness / user.favorRequiredBusiness) * 100))
      : 0;

    let sponsorCode = null;
    if (user.sponsor) {
        const sponsorUser = await User.findById(user.sponsor);
        if (sponsorUser) {
            sponsorCode = sponsorUser.referralCode;
        }
    }

    return {
        id: user._id,
        firebaseUid: user.firebaseUid,
        name: user.name,
        email: user.email,
        emailVerified: emailVerified,
        phone: user.phone,
        imageUrl: user.imageUrl || null,
        referralCode: user.referralCode,
        sponsor: sponsorCode,
        kycStatus: user.kycStatus,
        status: user.status,
        unlockedLevels: user.unlockedLevels || [1],
        vipRank: user.vipRank || 0,
        achievementRank: user.achievementRank || 0,
        createdAt: user.createdAt,
        teamBonusDeadline: user.teamBonusDeadline || null,

        // Favor condition details
        favorConditionEnabled: user.favorConditionEnabled,
        favorAmount: user.favorAmount,
        favorRequiredBusiness: user.favorRequiredBusiness,
        favorAchievedBusiness: achievedBusiness,
        favorRemainingBusiness: remainingBusiness,
        favorProgressPercent: progressPercent,
        favorWithdrawalStatus: user.favorWithdrawalStatus,
        favorCycleStartDate: user.favorCycleStartDate,
        favorCycleEndDate: user.favorCycleEndDate,
        favorLastQualificationDate: user.favorLastQualificationDate,

        role: roles[0] || 'USER',
        roles: roles.length ? roles : ['USER'],

        // Registration bonus state (used by frontend for bonus banner & modal)
        registrationBonusActive: user.registrationBonusActive !== false, // default true for new users
        freeRegBonus: wallet?.freeRegBonus || 0,

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
            adminAllocated: wallet?.adminAllocated || 0,
            roi: wallet?.roi || 0,
            referral: wallet?.referral || 0,
            bonusActivation: wallet?.bonusActivation || 0,
            bonusTransferable: wallet?.bonusTransferable || 0,
            bonusReceived: wallet?.bonusReceived || 0,
            freeRegBonus: wallet?.freeRegBonus || 0,
            salary: wallet?.salary || 0,
            achievement: wallet?.achievement || 0,
            withdrawal: wallet?.withdrawal || 0
        }
    };
};

export const sendOtp = async (req, res) => {
    try {
        const { phone, email } = req.body;

        if (!phone) {
            return sendError(res, 'Phone number is required', 400);
        }

        // 1. Validate phone and email are not already registered (Commented out temporarily)
        /*
        const existingPhone = await User.findOne({ phone: phone.trim() });
        if (existingPhone) {
            return sendError(res, 'Phone number is already registered', 400);
        }

        if (email) {
            const existingEmail = await User.findOne({ email: email.trim().toLowerCase() });
            if (existingEmail) {
                return sendError(res, 'Email address is already registered', 400);
            }
        }
        */


        const formattedPhone = formatE164Phone(phone);
        const twilioConfig = getTwilioClient();

        if (twilioConfig) {
            const { client, serviceSid } = twilioConfig;
            try {
                console.log(`[Twilio Verify] Requesting OTP send to ${formattedPhone} via service ${serviceSid}...`);
                const verification = await client.verify.v2
                    .services(serviceSid)
                    .verifications.create({
                        to: formattedPhone,
                        channel: 'sms'
                    });
                console.log(`[Twilio Verify] Verification created successfully:`, verification.sid);
                
                return successResponse(res, 'Verification code sent successfully');
            } catch (err) {
                console.error('[Twilio Verify] Failed to send verification code via Twilio API:', err);
                return sendError(res, `Failed to dispatch verification code via Twilio Verify: ${err.message}`, 500);
            }
        } else {
            // Local fallback logic (development mock)
            const code = Math.floor(100000 + Math.random() * 900000).toString();

            // Clear previous OTPs for this phone number
            await Otp.deleteMany({ phone: phone.trim() });

            // Save new OTP to DB (expires in 5 minutes)
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
            const otpRecord = new Otp({
                phone: phone.trim(),
                code,
                expiresAt
            });
            await otpRecord.save();

            console.log(`
==================================================
[SMS OTP GATEWAY MOCK]
Twilio Verify credentials are not fully set in .env. Falling back to mock console log.
Sending verification code: ${code}
To phone number: ${phone}
Expires at: ${expiresAt.toLocaleString()}
==================================================
`);

            const isDev = process.env.NODE_ENV !== 'production';
            return successResponse(res, 'Verification code sent successfully', {
                ...(isDev && { devOtp: code })
            });
        }
    } catch (error) {
        console.error('Send OTP error:', error);
        return sendError(res, 'Failed to send OTP verification code', 500, error);
    }
};

export const verifyOtp = async (req, res) => {
    try {
        const { phone, code } = req.body;

        if (!phone || !code) {
            return sendError(res, 'Phone number and verification code are required', 400);
        }

        const formattedPhone = formatE164Phone(phone);
        const twilioConfig = getTwilioClient();
        let isVerified = false;

        if (twilioConfig) {
            const { client, serviceSid } = twilioConfig;
            try {
                console.log(`[Twilio Verify] Checking OTP for ${formattedPhone}...`);
                const check = await client.verify.v2
                    .services(serviceSid)
                    .verificationChecks.create({
                        to: formattedPhone,
                        code: code.trim()
                    });

                if (check.status === 'approved') {
                    isVerified = true;
                } else {
                    return sendError(res, 'Invalid verification code. Please check and try again.', 400);
                }
            } catch (err) {
                console.error('[Twilio Verify] Verification failed via Twilio API:', err);
                return sendError(res, `Failed to verify OTP code via Twilio Verify: ${err.message}`, 500);
            }
        } else {
            // Local fallback logic
            const otpRecord = await Otp.findOne({ phone: phone.trim() }).sort({ createdAt: -1 });

            if (!otpRecord) {
                return sendError(res, 'No OTP code was generated for this phone number', 400);
            }

            if (otpRecord.expiresAt < new Date()) {
                return sendError(res, 'Verification code has expired. Please request a new one.', 400);
            }

            if (otpRecord.code !== code.trim()) {
                return sendError(res, 'Invalid verification code. Please check and try again.', 400);
            }

            otpRecord.isVerified = true;
            await otpRecord.save();
            isVerified = true;
        }

        if (isVerified) {
            // Generate signed token representing verified phone number
            const tokenPayload = {
                phone: phone.trim(),
                verified: true
            };
            const phoneVerificationToken = jwt.sign(
                tokenPayload,
                process.env.JWT_SECRET || 'skyrise_future_super_secure_jwt_token_key_2026',
                { expiresIn: '15m' }
            );

            return successResponse(res, 'Phone number verified successfully', {
                phoneVerificationToken
            });
        }
    } catch (error) {
        console.error('Verify OTP error:', error);
        return sendError(res, 'Failed to verify OTP code', 500, error);
    }
};

export const completeUserOnboarding = async (user, req) => {
    // 1. Ensure user role
    await ensureUserRole(user._id);

    // 2. Setup referral tree node if it doesn't exist
    let referralNode = await ReferralTree.findOne({ user: user._id });
    if (!referralNode) {
        let uplineAncestors = [];
        let sponsorUser = null;
        if (user.sponsor) {
            sponsorUser = await User.findById(user.sponsor);
            if (sponsorUser) {
                const sponsorNode = await ReferralTree.findOne({ user: sponsorUser._id });
                if (sponsorNode) {
                    uplineAncestors = [sponsorUser._id, ...sponsorNode.ancestors];
                } else {
                    uplineAncestors = [sponsorUser._id];
                }
            }
        }

        referralNode = await ReferralTree.create({
            user: user._id,
            referredBy: user.sponsor || null,
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
            
            // Trigger $1 Team Joins bonus calculations
            await payoutTeamBonusJoin(user._id);
        }
    }

    // 3. Create wallets and credit freeRegBonus if they don't exist
    let wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
        wallet = await Wallet.create({
            user: user._id,
            deposit: 0,
            freeRegBonus: 5,
            roi: 0,
            referral: 0,
            bonusActivation: 0,
            bonusTransferable: 0,
            bonusReceived: 0,
            salary: 0,
            achievement: 0,
            withdrawal: 0
        });

        await WalletHistory.create({
            user: user._id,
            walletType: 'freeRegBonus',
            type: 'credit',
            amount: 5,
            previousBalance: 0,
            newBalance: 5,
            category: 'free_reg_bonus',
            description: 'Welcome promotional signup credit. Valid for first investment merge only.'
        });
    }

    // 4. Update status in MongoDB
    user.emailVerified = true;
    user.status = 'active';
    await user.save();

    // 5. Log Security event
    await SecurityLog.create({
        user: user._id,
        event: 'FIREBASE_USER_SYNCED',
        description: `Firebase account onboarding completed & synced for email: ${user.email}`,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'unknown'
    });
};

export const syncFirebaseUser = async (req, res) => {
    try {
        const { idToken, name, phone, sponsorCode, phoneVerificationToken } = req.body;

        // Verify phone verification token (Commented out temporarily)
        /*
        if (!phoneVerificationToken) {
            return sendError(res, 'Phone verification token is required to complete registration', 400);
        }

        try {
            const decoded = jwt.verify(
                phoneVerificationToken,
                process.env.JWT_SECRET || 'skyrise_future_super_secure_jwt_token_key_2026'
            );
            
            const normalizedDecodedPhone = decoded.phone.trim().replace(/\s+/g, '');
            const normalizedPhone = phone.trim().replace(/\s+/g, '');
            
            if (!decoded || normalizedDecodedPhone !== normalizedPhone || !decoded.verified) {
                return sendError(res, 'Invalid or expired phone verification token', 400);
            }
        } catch (jwtErr) {
            console.error('Phone verification token validation failed:', jwtErr);
            return sendError(res, 'Phone verification token has expired or is invalid. Please verify your phone number again.', 400);
        }
        */

        if (!idToken) {
            return sendError(res, 'Firebase ID token is required', 400);
        }

        const decodedToken = await admin.auth().verifyIdToken(idToken);

        const firebaseUid = decodedToken.uid;
        const email = decodedToken.email;
        const isEmailVerified = decodedToken.email_verified || false;

        if (!email) {
            return sendError(res, 'Firebase account email is required', 400);
        }

        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1';
        const userAgent = req.headers['user-agent'] || 'unknown';

        let existingUser = await User.findOne({ firebaseUid });

        if (existingUser) {
            if (existingUser.status === 'suspended') {
                return sendError(res, 'Your account is suspended. Contact Support.', 403);
            }

            if (!isEmailVerified) {
                // If they are not verified in Firebase, return pending status
                return res.status(200).json({
                    success: true,
                    status: 'PENDING_EMAIL_VERIFICATION',
                    message: 'Email verification is required to complete registration.'
                });
            }

            // Complete onboarding if they were unverified/pending previously
            if (!existingUser.emailVerified || existingUser.status === 'pending_verification') {
                await completeUserOnboarding(existingUser, req);
            } else {
                await ensureUserRole(existingUser._id);
            }

            const userPayload = await buildFirebaseUserResponse(existingUser, true);

            return successResponse(res, 'Firebase user synced successfully', {
                user: userPayload
            });
        }

        const emailExists = await User.findOne({ email });

        if (emailExists) {
            if (emailExists.status === 'suspended') {
                return sendError(res, 'Associated profile is suspended. Contact Support.', 403);
            }

            if (!isEmailVerified) {
                return res.status(200).json({
                    success: true,
                    status: 'PENDING_EMAIL_VERIFICATION',
                    message: 'Email verification is required to complete registration.'
                });
            }

            emailExists.firebaseUid = firebaseUid;
            await emailExists.save();

            await completeUserOnboarding(emailExists, req);

            const userPayload = await buildFirebaseUserResponse(emailExists, true);

            return successResponse(res, 'Firebase account linked and synced successfully', {
                user: userPayload
            });
        }

        // New Registration

        if (process.env.REGISTRATION_LOCK === 'true') {
            return res.status(403).json({
                success: false,
                message: 'New registrations are temporarily paused for security maintenance.'
            });
        }

        // 1. Block disposable emails
        if (isDisposableEmail(email)) {
            return sendError(res, 'Registration using disposable email addresses is not allowed.', 400);
        }

        // Validate sponsor code first (even for unverified users) so we block suspended sponsors immediately
        let sponsorUser = null;
        if (sponsorCode) {
            sponsorUser = await User.findOne({ referralCode: sponsorCode.trim() });
            if (!sponsorUser) {
                return sendError(res, 'Invalid sponsor referral code', 400);
            }
            if (sponsorUser.canEarnReferral === false || sponsorUser.isBlocked || sponsorUser.status === 'suspended' || sponsorUser.status === 'SUSPENDED_EMAIL_UNVERIFIED') {
                return sendError(res, "You cannot use a suspended user's referral code. Please try another.", 400);
            }
        }

        // Defer MongoDB registration until the Firebase email has been verified
        if (!isEmailVerified) {
            const PendingRegistration = (await import('../models/auth/pending_registration.model.js')).default;
            await PendingRegistration.findOneAndUpdate(
                { firebaseUid },
                {
                    name: name || decodedToken.name || email.split('@')[0],
                    email,
                    phone: phone || '',
                    sponsorCode: sponsorCode || ''
                },
                { upsert: true, new: true }
            );

            await SecurityLog.create({
                event: 'USER_REGISTERED_UNVERIFIED_ATTEMPT',
                description: `Deferred MongoDB user creation for unverified Firebase email: ${email}`,
                ipAddress,
                userAgent
            });

            return res.status(200).json({
                success: true,
                status: 'PENDING_EMAIL_VERIFICATION',
                message: 'Email verification is required to complete registration.'
            });
        }

        // 2. Check IP registration velocity (flag if >= 3 accounts created from the same IP)
        const sameIpCount = await User.countDocuments({ signupIp: ipAddress });
        let isFlagged = false;
        let flagReason = null;
        if (sameIpCount >= 3) {
            isFlagged = true;
            flagReason = `Multiple accounts (${sameIpCount + 1}) registered from the same IP address: ${ipAddress}`;
            console.log(`[Suspicious Activity Flagged] IP: ${ipAddress} | Email: ${email}`);
        }

        const referralCode = await generateReferralCode();

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 10);

        const newUser = await User.create({
            firebaseUid,
            name: name || decodedToken.name || email.split('@')[0],
            email,
            phone: phone || '',
            sponsor: sponsorUser ? sponsorUser._id : null,
            referralCode,
            status: 'active',
            emailVerified: true,
            signupIp: ipAddress,
            signupUserAgent: userAgent,
            isFlagged,
            flagReason,
            teamBonusDeadline: deadline
        });

        await ensureUserRole(newUser._id);

        // Complete active onboarding immediately since the Firebase email is verified
        await completeUserOnboarding(newUser, req);

        if (isFlagged) {
            await SecurityLog.create({
                user: newUser._id,
                event: 'SUSPICIOUS_SIGNUP_FLAGGED',
                description: flagReason,
                ipAddress,
                userAgent
            });
        }

        const userPayload = await buildFirebaseUserResponse(newUser, true);

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
        const emailVerified = req.firebaseUser?.email_verified || false;
        const userPayload = await buildFirebaseUserResponse(user, emailVerified);

        return successResponse(res, 'Firebase protected profile fetched successfully', {
            user: userPayload
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