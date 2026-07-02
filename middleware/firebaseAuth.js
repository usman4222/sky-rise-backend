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
            return sendError(res, 'Firebase token missing', 401);
        }

        const decodedToken = await admin.auth().verifyIdToken(token);

        const user = await User.findOne({
            firebaseUid: decodedToken.uid
        });

        if (!user) {
            return sendError(res, 'User profile not found in MongoDB', 404);
        }

        if (user.status === 'suspended') {
            return sendError(res, 'Your account is suspended', 403);
        }

        req.firebaseUser = decodedToken;
        req.user = user;

        // If email is not verified, and this is NOT the "/me" profile route, block access for non-admins
        const isProfileRoute = req.originalUrl === '/api/firebase-auth/me' || req.path === '/me';
        if (!decodedToken.email_verified && !isProfileRoute) {
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

        return sendError(res, `Invalid or expired Firebase token: ${error.message}`, 401);
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