import rateLimit from 'express-rate-limit';
import SecurityLog from '../models/auth/security_log.model.js';

// Recursive XSS string sanitizer
const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
        .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
        .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/on\w+\s*=\s*'[^']*'/gi, '')
        .replace(/on\w+\s*=\s*\w+/gi, '')
        .replace(/javascript:[^"']*/gi, '')
        .replace(/<\/?[^>]+(>|$)/g, ''); // Strip standard HTML tags
};

const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (typeof obj[key] === 'string') {
                obj[key] = sanitizeString(obj[key]);
            } else if (typeof obj[key] === 'object') {
                sanitizeObject(obj[key]);
            }
        }
    }
    return obj;
};

// Custom XSS Sanitizer middleware
export const xssSanitizer = (req, res, next) => {
    if (req.body) sanitizeObject(req.body);
    if (req.query) sanitizeObject(req.query);
    if (req.params) sanitizeObject(req.params);
    next();
};

const cleanNoSql = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (key.startsWith('$') || key.includes('.')) {
                delete obj[key];
            } else if (typeof obj[key] === 'object') {
                cleanNoSql(obj[key]);
            }
        }
    }
    return obj;
};

// Custom NoSQL Query Sanitizer middleware (Express 5 Safe)
export const noSqlSanitizer = (req, res, next) => {
    if (req.body) cleanNoSql(req.body);
    if (req.query) cleanNoSql(req.query);
    if (req.params) cleanNoSql(req.params);
    next();
};

// Request locks to prevent race conditions / duplicate spends
const activeUserRequests = new Set();

export const requestLockGuard = (req, res, next) => {
    // If no user session is bound, skip lock
    const userId = req.user?._id || req.firebaseUser?.uid;
    if (!userId) return next();

    const key = userId.toString();
    if (activeUserRequests.has(key)) {
        return res.status(409).json({
            success: false,
            message: 'Another request is currently processing for your account. Please wait.'
        });
    }

    activeUserRequests.add(key);

    const releaseLock = () => {
        activeUserRequests.delete(key);
    };

    // Release lock when request completes or connection drops
    res.on('finish', releaseLock);
    res.on('close', releaseLock);

    next();
};

// Security event log helper
export const logSecurityEvent = async ({ user = null, event, description, req }) => {
    try {
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const userAgent = req.headers['user-agent'] || 'unknown';
        await SecurityLog.create({
            user,
            event,
            description,
            ipAddress,
            userAgent
        });
    } catch (err) {
        console.error('Failed to log security event:', err);
    }
};

// 1. General global rate limiter
export const generalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
    message: {
        success: false,
        message: 'Too many requests from this IP. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 2. Sensitive login & register rate limiter
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    handler: async (req, res, next, options) => {
        await logSecurityEvent({
            event: 'AUTH_RATE_LIMIT_TRIGGERED',
            description: `IP address triggered auth rate limits. URL: ${req.originalUrl}`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many authentication attempts. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 3. OTP dispatch rate limiter
export const otpRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    handler: async (req, res, next, options) => {
        await logSecurityEvent({
            event: 'OTP_RATE_LIMIT_TRIGGERED',
            description: `IP address triggered OTP rate limits. Phone: ${req.body.phone || 'unknown'}`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many OTP requests. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 4. Financial actions rate limiter
export const financeRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    handler: async (req, res, next, options) => {
        const userId = req.user?._id || null;
        await logSecurityEvent({
            user: userId,
            event: 'FINANCE_RATE_LIMIT_TRIGGERED',
            description: `Financial transaction rate limit triggered. URL: ${req.originalUrl}`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many financial operations request. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 5. Admin operations rate limiter
export const adminRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    handler: async (req, res, next, options) => {
        const userId = req.user?._id || null;
        await logSecurityEvent({
            user: userId,
            event: 'ADMIN_RATE_LIMIT_TRIGGERED',
            description: `Admin control rate limit triggered. URL: ${req.originalUrl}`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many admin operations. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 6. Registration rate limiter: Max 5 per IP per hour
export const registrationRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    handler: async (req, res, next, options) => {
        await logSecurityEvent({
            event: 'REGISTRATION_RATE_LIMIT_TRIGGERED',
            description: `IP address triggered registration rate limits. Email: ${req.body.email || 'unknown'}`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many accounts registered from this IP. Please try again after an hour.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 7. Verification email resend rate limiter: Max 3 per hour
export const resendVerificationRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    handler: async (req, res, next, options) => {
        await logSecurityEvent({
            event: 'VERIFICATION_RESEND_RATE_LIMIT_TRIGGERED',
            description: `IP address triggered verification email resend limits.`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many verification email requests. Please try again after an hour.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 8. Password reset rate limiter: Max 3 per hour
export const passwordResetRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    handler: async (req, res, next, options) => {
        await logSecurityEvent({
            event: 'PASSWORD_RESET_RATE_LIMIT_TRIGGERED',
            description: `IP address triggered password reset rate limits.`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many password reset attempts. Please try again after an hour.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 9. Firebase sync rate limiter: Max 15 per 15 minutes per IP
export const firebaseSyncRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    handler: async (req, res, next, options) => {
        await logSecurityEvent({
            event: 'FIREBASE_SYNC_RATE_LIMIT_TRIGGERED',
            description: `IP address triggered Firebase sync rate limits.`,
            req
        });
        res.status(options.statusCode).send(options.message);
    },
    message: {
        success: false,
        message: 'Too many sync attempts. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// 10. Memory-based IP Lockout for Failed Logins: Max 5 failed logins within 15 minutes per IP
const failedLoginAttempts = new Map();

export const trackFailedLogin = (ip) => {
    const now = Date.now();
    const attempts = failedLoginAttempts.get(ip);
    if (!attempts || attempts.expiresAt < now) {
        failedLoginAttempts.set(ip, { count: 1, expiresAt: now + 15 * 60 * 1000 });
    } else {
        attempts.count += 1;
        failedLoginAttempts.set(ip, attempts);
    }
};

export const resetFailedLogin = (ip) => {
    failedLoginAttempts.delete(ip);
};

export const checkFailedLoginLimit = async (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const attempts = failedLoginAttempts.get(ip);
    
    if (attempts && attempts.expiresAt > now && attempts.count >= 5) {
        await SecurityLog.create({
            event: 'LOGIN_LOCKOUT_TRIGGERED',
            description: `IP locked out due to 5+ failed login attempts. Attempt count: ${attempts.count}`,
            ipAddress: ip,
            userAgent: req.headers['user-agent'] || 'unknown'
        });
        return res.status(429).json({
            success: false,
            message: 'Too many failed login attempts. Access is locked for 15 minutes.'
        });
    }
    next();
};
