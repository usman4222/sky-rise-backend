import admin from '../config/firebase.js';
import User from '../models/auth/user.model.js';
import UserRole from '../models/auth/user_role.model.js';
import SecurityLog from '../models/auth/security_log.model.js';
import { sendError } from '../utils/response.js';

export const firebaseProtect = async (req, res, next) => {
    try {
        let token;

        if (
            req.headers.authorization &&
            req.headers.authorization.startsWith('Bearer')
        ) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return sendError(res, 'Session token missing. Please log in.', 401);
        }

        const decodedToken = await admin.auth().verifyIdToken(token);

        let user = await User.findOne({
            firebaseUid: decodedToken.uid
        });

        if (!user && decodedToken.email) {
            user = await User.findOne({ email: decodedToken.email });
            if (user) {
                user.firebaseUid = decodedToken.uid;
                if (decodedToken.email_verified) {
                    user.emailVerified = true;
                }
                await user.save();
                console.log(`[Self-Healing] Linked existing MongoDB email ${user.email} to new Firebase UID ${decodedToken.uid}`);
            }
        }

        if (!user) {
            if (decodedToken.email_verified === true) {
                const PendingRegistration = (await import('../models/auth/pending_registration.model.js')).default;
                const Role = (await import('../models/auth/role.model.js')).default;
                const UserRole = (await import('../models/auth/user_role.model.js')).default;
                const ReferralTree = (await import('../models/network/referral_tree.model.js')).default;
                const { default: crypto } = await import('crypto');
                const { completeUserOnboarding } = await import('../controllers/firebaseAuth.controller.js');

                const pendingReg = await PendingRegistration.findOne({ firebaseUid: decodedToken.uid });
                if (pendingReg) {
                    let sponsorUser = null;
                    let uplineAncestors = [];

                    if (pendingReg.sponsorCode) {
                        const tempSponsor = await User.findOne({ referralCode: pendingReg.sponsorCode.trim() });
                        if (tempSponsor) {
                            const isSponsorActive = tempSponsor.canEarnReferral !== false && 
                                                    !tempSponsor.isBlocked && 
                                                    tempSponsor.status !== 'suspended' && 
                                                    tempSponsor.status !== 'SUSPENDED_EMAIL_UNVERIFIED';
                            
                            if (isSponsorActive) {
                                sponsorUser = tempSponsor;
                                const sponsorNode = await ReferralTree.findOne({ user: sponsorUser._id });
                                if (sponsorNode) {
                                    uplineAncestors = [sponsorUser._id, ...sponsorNode.ancestors];
                                }
                            } else {
                                console.log(`[Graduation Sponsor Ignored] Sponsor ${tempSponsor.email} is suspended/blocked. Registering user without sponsor.`);
                            }
                        }
                    }

                    let referralCode;
                    let codeExists = true;
                    while (codeExists) {
                        const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
                        referralCode = `SF${rand}`;
                        const existingCode = await User.findOne({ referralCode });
                        if (!existingCode) codeExists = false;
                    }

                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + 10);

                    const newUser = await User.create({
                        firebaseUid: pendingReg.firebaseUid,
                        name: pendingReg.name,
                        email: pendingReg.email,
                        phone: pendingReg.phone,
                        sponsor: sponsorUser ? sponsorUser._id : null,
                        referralCode,
                        status: 'active',
                        emailVerified: true,
                        signupIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
                        signupUserAgent: req.headers['user-agent'] || 'unknown',
                        teamBonusDeadline: deadline
                    });

                    const userRoleObj = await Role.findOne({ name: 'USER' });
                    if (userRoleObj) {
                        await UserRole.create({
                            user: newUser._id,
                            role: userRoleObj._id
                        });
                    }

                    const referralNode = new ReferralTree({
                        user: newUser._id,
                        referredBy: sponsorUser ? sponsorUser._id : null,
                        ancestors: uplineAncestors
                    });
                    await referralNode.save();

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

                    await completeUserOnboarding(newUser, req);

                    const SecurityLog = (await import('../models/auth/security_log.model.js')).default;
                    await SecurityLog.create({
                        user: newUser._id,
                        event: 'USER_REGISTERED',
                        description: `Successfully graduated verified account profile from PendingRegistration via email: ${pendingReg.email}`,
                        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
                        userAgent: req.headers['user-agent'] || 'unknown'
                    });

                    await PendingRegistration.deleteOne({ _id: pendingReg._id });

                    user = newUser;
                } else {
                    // Fallback self-healing: create profile using token details (for users registered before PendingRegistration model was active)
                    let referralCode;
                    let codeExists = true;
                    while (codeExists) {
                        const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
                        referralCode = `SF${rand}`;
                        const existingCode = await User.findOne({ referralCode });
                        if (!existingCode) codeExists = false;
                    }

                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + 10);

                    const newUser = await User.create({
                        firebaseUid: decodedToken.uid,
                        name: decodedToken.name || decodedToken.email.split('@')[0],
                        email: decodedToken.email,
                        phone: decodedToken.phone_number || '',
                        sponsor: null,
                        referralCode,
                        status: 'active',
                        emailVerified: true,
                        signupIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
                        signupUserAgent: req.headers['user-agent'] || 'unknown',
                        teamBonusDeadline: deadline
                    });

                    const userRoleObj = await Role.findOne({ name: 'USER' });
                    if (userRoleObj) {
                        await UserRole.create({
                            user: newUser._id,
                            role: userRoleObj._id
                        });
                    }

                    const referralNode = new ReferralTree({
                        user: newUser._id,
                        referredBy: null,
                        ancestors: []
                    });
                    await referralNode.save();

                    await completeUserOnboarding(newUser, req);

                    const SecurityLog = (await import('../models/auth/security_log.model.js')).default;
                    await SecurityLog.create({
                        user: newUser._id,
                        event: 'USER_REGISTERED_FALLBACK',
                        description: `Successfully self-healed and registered verified account profile directly from Firebase token: ${decodedToken.email}`,
                        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
                        userAgent: req.headers['user-agent'] || 'unknown'
                    });

                    user = newUser;
                }
            }
        }

        if (!user) {
            return sendError(res, 'Account profile not found. Please register or contact support.', 404);
        }

        if (user.isBlocked || user.status === 'SUSPENDED_EMAIL_UNVERIFIED') {
            return sendError(res, 'Your account is blocked. Contact Support.', 403);
        }

        if (user.status === 'suspended') {
            return sendError(res, 'Your account is suspended', 403);
        }

        req.firebaseUser = decodedToken;
        req.user = user;

        // Self-heal: If user is verified in Firebase but not marked as verified in MongoDB, update it!
        if (decodedToken.email_verified === true && !user.emailVerified) {
            user.emailVerified = true;
            await user.save();
            console.log(`[Self-Healing] Marked email as verified in MongoDB for ${user.email}`);
        }

        // If email is not verified, and this is NOT the "/me" profile route, block access for non-admins
        const isProfileRoute = req.originalUrl === '/api/firebase-auth/me' || req.path === '/me';
        if ((!decodedToken.email_verified || !user.emailVerified || user.status === 'pending_verification') && !isProfileRoute) {
            const userRoles = await UserRole.find({ user: user._id }).populate('role');
            const roles = userRoles.map((item) => item.role?.name).filter(Boolean);
            const isAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');

            if (!isAdmin) {
                await SecurityLog.create({
                    user: user._id,
                    event: 'BLOCKED_UNVERIFIED_EMAIL',
                    description: `Blocked access attempt to unverified account: ${user.email}. URL: ${req.originalUrl}`,
                    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
                    userAgent: req.headers['user-agent'] || 'unknown'
                });
                return sendError(res, 'Email verification required. Please verify your email to access this resource.', 403);
            }
        }

        next();
    } catch (error) {
        console.error('Firebase auth error:', error);

        return sendError(res, 'Session expired or invalid. Please log in again.', 401);
    }
};

export const firebaseProtectOptional = async (req, res, next) => {
    try {
        let token;

        if (
            req.headers.authorization &&
            req.headers.authorization.startsWith('Bearer')
        ) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return next();
        }

        const decodedToken = await admin.auth().verifyIdToken(token);

        const user = await User.findOne({
            firebaseUid: decodedToken.uid
        });

        if (user && user.status !== 'suspended') {
            req.firebaseUser = decodedToken;
            req.user = user;
        }

        next();
    } catch (error) {
        // Fallback: ignore expired/invalid tokens and treat as guest
        next();
    }
};