import UserRole from '../models/auth/user_role.model.js';
import Role from '../models/auth/role.model.js';

// Response helpers
import { sendError } from '../utils/response.js';

// Check if user has specified roles
const restrictTo = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return sendError(res, 'Unauthorized context', 401);
      }

      // Fetch user's assigned roles
      const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
      const roleNames = userRoles.map(ur => ur.role.name);

      // Super Admins override all checks
      if (roleNames.includes('SUPER_ADMIN')) {
        return next();
      }

      const hasRole = allowedRoles.some(role => roleNames.includes(role));
      if (!hasRole) {
        return sendError(res, 'Forbidden: Insufficient privileges', 403);
      }

      next();
    } catch (error) {
      console.error('RBAC restrictTo error:', error.message);
      return sendError(res, 'RBAC validation error', 500);
    }
  };
};

// Check if user's roles contain specific permission
const hasPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return sendError(res, 'Unauthorized context', 401);
      }

      // Fetch user roles
      const userRoles = await UserRole.find({ user: req.user._id }).populate({
        path: 'role',
        populate: { path: 'permissions' }
      });

      const roleNames = userRoles.map(ur => ur.role.name);
      if (roleNames.includes('SUPER_ADMIN')) {
        return next(); // Super admin bypass
      }

      // Aggregate all active permissions across user roles
      const allPermissions = [];
      userRoles.forEach(ur => {
        if (ur.role && ur.role.permissions) {
          ur.role.permissions.forEach(p => {
            allPermissions.push(p.name);
          });
        }
      });

      if (!allPermissions.includes(requiredPermission)) {
        return sendError(res, `Forbidden: Missing required permission [${requiredPermission}]`, 403);
      }

      next();
    } catch (error) {
      console.error('RBAC hasPermission error:', error.message);
      return sendError(res, 'Permission validation error', 500);
    }
  };
};

export { restrictTo, hasPermission };
