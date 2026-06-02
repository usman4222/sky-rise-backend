import admin from '../config/firebase.js';
import User from '../models/auth/user.model.js';
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

        next();
    } catch (error) {
        console.error('Firebase auth error:', error.message);

        return sendError(res, 'Invalid or expired Firebase token', 401);
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