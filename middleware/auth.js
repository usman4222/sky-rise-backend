import jwt from 'jsonwebtoken';
import User from '../models/auth/user.model.js';
import LoginSession from '../models/auth/login_session.model.js';

// Response helpers
import { sendError } from '../utils/response.js';

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'skyrise_future_super_secure_jwt_token_key_2026');

      // Check if session is revoked
      const session = await LoginSession.findOne({ token, isRevoked: false });
      if (!session) {
        return sendError(res, 'Session expired or revoked', 401);
      }

      // Check session expiry
      if (new Date() > session.expiresAt) {
        session.isRevoked = true;
        await session.save();
        return sendError(res, 'Session expired', 401);
      }

      // Fetch user profile
      const user = await User.findById(decoded.id);
      if (!user) {
        return sendError(res, 'User account not found', 401);
      }

      if (user.status === 'suspended') {
        return sendError(res, 'Your account is suspended', 403);
      }

      // Bind context
      req.user = user;
      req.token = token;
      next();
    } catch (error) {
      console.error('Auth protect error:', error.message);
      return sendError(res, 'Not authorized, invalid token', 401);
    }
  } else {
    return sendError(res, 'Not authorized, token missing', 401);
  }
};

export { protect };
