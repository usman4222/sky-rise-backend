import { sendError } from '../utils/response.js';
import SecurityLog from '../models/auth/security_log.model.js';

/**
 * Validates Cloudflare Turnstile token programmatically.
 */
export const verifyCaptchaToken = async (token, ip) => {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    
    if (!secretKey || process.env.NODE_ENV === 'test') {
        console.log('[CAPTCHA Bypass] CAPTCHA skipped (Secret key missing or running in test mode)');
        return true;
    }

    if (!token) {
        return false;
    }

    try {
        const verificationUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
        
        const bodyParams = {
            secret: secretKey,
            response: token
        };

        // Omit local loopback IP addresses since Cloudflare siteverify rejects them
        if (ip && ip !== '::1' && ip !== '127.0.0.1' && !ip.startsWith('::ffff:127.')) {
            bodyParams.remoteip = ip;
        }

        const response = await fetch(verificationUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams(bodyParams)
        });

        const data = await response.json();
        return !!data.success;
    } catch (error) {
        console.error('[CAPTCHA Error] Error validating Turnstile token:', error);
        return false;
    }
};

/**
 * Middleware to verify Cloudflare Turnstile CAPTCHA response.
 */
export const verifyCaptcha = async (req, res, next) => {
    const captchaResponse = req.body['cf-turnstile-response'] || req.headers['x-captcha-token'];
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    const isValid = await verifyCaptchaToken(captchaResponse, ip);

    if (!isValid) {
        // Log security warning
        await SecurityLog.create({
            event: 'CAPTCHA_VERIFICATION_FAILED',
            description: `Turnstile validation failed via middleware for URL: ${req.originalUrl}`,
            ipAddress: ip,
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        return sendError(res, 'CAPTCHA verification failed. Please try again.', 400);
    }

    next();
};
