import UserPaymentMethod from '../models/finance/user_payment_method.model.js';
import { successResponse, sendError } from '../utils/response.js';

// @desc    Add new payment method
// @route   POST /api/payment-methods
// @access  Private (Logged-in user)
export const addPaymentMethod = async (req, res) => {
  try {
    const {
      methodType,
      accountTitle,
      accountNumber,
      walletAddress,
      bankName,
      iban,
      phoneNumber,
      network,
      isDefault
    } = req.body;

    const userId = req.user._id;

    // Type validations
    if (!methodType || !accountTitle || !accountNumber) {
      return sendError(res, 'Method type, account title, and account number are required', 400);
    }

    if (!['bank', 'raast', 'jazzcash', 'easypaisa', 'usdt_trc20'].includes(methodType)) {
      return sendError(res, 'Invalid payment method type', 400);
    }

    // Specific validation rules
    if (methodType === 'usdt_trc20' && !walletAddress) {
      return sendError(res, 'Wallet address is required for USDT BEP20', 400);
    }

    if (methodType === 'bank' && !bankName) {
      return sendError(res, 'Bank name is required for bank payment methods', 400);
    }

    if (['jazzcash', 'easypaisa', 'raast'].includes(methodType) && !phoneNumber) {
      return sendError(res, 'Phone number is required for mobile/Raast accounts', 400);
    }

    // If setting default, unset existing default methods
    if (isDefault) {
      await UserPaymentMethod.updateMany(
        { user: userId, status: 'active' },
        { isDefault: false }
      );
    }

    // Check if this is the user's first active method, if so make it default automatically
    const existingCount = await UserPaymentMethod.countDocuments({ user: userId, status: 'active' });
    const finalIsDefault = existingCount === 0 ? true : !!isDefault;

    const newMethod = await UserPaymentMethod.create({
      user: userId,
      methodType,
      accountTitle,
      accountNumber,
      walletAddress: methodType === 'usdt_trc20' ? walletAddress : (walletAddress || accountNumber),
      bankName,
      iban,
      phoneNumber,
      network: methodType === 'usdt_trc20' ? (network || 'TRC20') : null,
      isDefault: finalIsDefault,
      status: 'active'
    });

    return successResponse(res, 'Payment method added successfully', { paymentMethod: newMethod }, 201);
  } catch (error) {
    console.error('addPaymentMethod error:', error);
    return sendError(res, 'Failed to add payment method', 500, error);
  }
};

// @desc    Get user payment methods
// @route   GET /api/payment-methods/my
// @access  Private
export const getMyPaymentMethods = async (req, res) => {
  try {
    const paymentMethods = await UserPaymentMethod.find({
      user: req.user._id,
      status: 'active'
    }).sort({ isDefault: -1, createdAt: -1 });

    return successResponse(res, 'Payment methods retrieved successfully', { paymentMethods });
  } catch (error) {
    console.error('getMyPaymentMethods error:', error);
    return sendError(res, 'Failed to retrieve payment methods', 500, error);
  }
};

// @desc    Update payment method
// @route   PUT /api/payment-methods/:id
// @access  Private
export const updatePaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const method = await UserPaymentMethod.findOne({ _id: id, user: userId, status: 'active' });
    if (!method) {
      return sendError(res, 'Payment method not found', 404);
    }

    const {
      accountTitle,
      accountNumber,
      walletAddress,
      bankName,
      iban,
      phoneNumber,
      network,
      isDefault
    } = req.body;

    if (accountTitle) method.accountTitle = accountTitle;
    if (accountNumber) method.accountNumber = accountNumber;
    if (walletAddress !== undefined) method.walletAddress = walletAddress;
    if (bankName !== undefined) method.bankName = bankName;
    if (iban !== undefined) method.iban = iban;
    if (phoneNumber !== undefined) method.phoneNumber = phoneNumber;
    if (network !== undefined) method.network = network;

    if (isDefault) {
      await UserPaymentMethod.updateMany(
        { user: userId, status: 'active' },
        { isDefault: false }
      );
      method.isDefault = true;
    }

    await method.save();

    return successResponse(res, 'Payment method updated successfully', { paymentMethod: method });
  } catch (error) {
    console.error('updatePaymentMethod error:', error);
    return sendError(res, 'Failed to update payment method', 500, error);
  }
};

// @desc    Soft delete payment method
// @route   DELETE /api/payment-methods/:id
// @access  Private
export const deletePaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const method = await UserPaymentMethod.findOne({ _id: id, user: userId, status: 'active' });
    if (!method) {
      return sendError(res, 'Payment method not found', 404);
    }

    method.status = 'inactive';
    method.isDefault = false;
    await method.save();

    // If we deleted the default method, make another active one default if exists
    const remaining = await UserPaymentMethod.findOne({ user: userId, status: 'active' });
    if (remaining) {
      remaining.isDefault = true;
      await remaining.save();
    }

    return successResponse(res, 'Payment method deactivated successfully');
  } catch (error) {
    console.error('deletePaymentMethod error:', error);
    return sendError(res, 'Failed to deactivate payment method', 500, error);
  }
};

// @desc    Set default payment method
// @route   PATCH /api/payment-methods/:id/default
// @access  Private
export const setDefaultPaymentMethod = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const method = await UserPaymentMethod.findOne({ _id: id, user: userId, status: 'active' });
    if (!method) {
      return sendError(res, 'Payment method not found', 404);
    }

    // Unset default status for all other active payment methods of this user
    await UserPaymentMethod.updateMany(
      { user: userId, status: 'active' },
      { isDefault: false }
    );

    // Atomically set the selected payment method to isDefault: true
    const updatedMethod = await UserPaymentMethod.findOneAndUpdate(
      { _id: id, user: userId, status: 'active' },
      { isDefault: true },
      { new: true }
    );

    return successResponse(res, 'Default payment method updated successfully', { paymentMethod: updatedMethod });
  } catch (error) {
    console.error('setDefaultPaymentMethod error:', error);
    return sendError(res, 'Failed to update default payment method', 500, error);
  }
};
