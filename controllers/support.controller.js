import SupportTicket from '../models/system/support_ticket.model.js';
import UserRole from '../models/auth/user_role.model.js';
import Role from '../models/auth/role.model.js';
import User from '../models/auth/user.model.js';
import Notification from '../models/system/notification.model.js';
import mongoose from 'mongoose';
import { sendError, successResponse } from '../utils/response.js';

// Simulated AI auto-reply agent
const simulateAiResponse = async (ticketId) => {
  try {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket || ticket.status === 'closed') return;

    // 1. Determine sender (Admin / Support Bot)
    const adminRole = await Role.findOne({ name: { $in: ['ADMIN', 'SUPER_ADMIN'] } });
    let botUserId = null;
    if (adminRole) {
      const userRole = await UserRole.findOne({ role: adminRole._id });
      if (userRole) {
        botUserId = userRole.user;
      }
    }
    if (!botUserId) {
      const anyUser = await User.findOne({});
      botUserId = anyUser ? anyUser._id : new mongoose.Types.ObjectId();
    }

    // 2. Generate contextual response based on keywords
    const content = `${ticket.subject} ${ticket.message}`.toLowerCase();
    let replyText = "";

    if (content.includes('deposit') || content.includes('payfast') || content.includes('pkr') || content.includes('usdt')) {
      replyText = "Hello! Manual deposits are processed by our verification queue within 1 to 12 hours. Please ensure you upload the correct transaction reference/hash and receipt. The minimum deposit amount is $10.";
    } else if (content.includes('withdraw') || content.includes('fee') || content.includes('payout')) {
      replyText = "Hello! Withdrawals are processed within 1 to 12 hours. Please note: \n1. Direct withdrawals from the deposit wallet are blocked.\n2. You must have at least one active investment package.\n3. A 5% withdrawal fee applies.\n4. The minimum withdrawal amount is $10.";
    } else if (content.includes('roi') || content.includes('reinvest') || content.includes('claim') || content.includes('timer')) {
      replyText = "Hello! If Auto-Reinvest is enabled, your daily ROI compounds directly into your investment principal. If disabled, you must manually claim your ROI under 'My Investments' within 24 hours (or 1 minute in Test Mode), after which unclaimed ROI will expire.";
    } else if (content.includes('vip') || content.includes('salary') || content.includes('rank') || content.includes('upline')) {
      replyText = "Hello! The VIP Weekly Salary is paid out automatically every 7 days (or 7 minutes in Test Mode) for active users who maintain 5 direct legs meeting the volume requirements. Direct referrers also receive team signup and investment rewards.";
    } else {
      replyText = "Thank you for contacting SkyRise Future Support. This is an automated AI response. Your ticket has been routed to our support team and is marked as 'open'. We will review it shortly. For details, please consult the Business Plan PDF or our main website FAQ.";
    }

    // 3. Save reply
    ticket.replies.push({
      sender: botUserId,
      message: replyText
    });
    ticket.status = 'answered';
    await ticket.save();

    // 4. Send notification to user
    await Notification.create({
      user: ticket.user,
      title: '💬 New Support Ticket Reply',
      message: `Your ticket regarding "${ticket.subject}" has received a reply.`,
      category: 'support'
    });

    console.log(`🤖 Simulated AI auto-reply sent for ticket ${ticketId}`);
  } catch (error) {
    console.error('Error simulating support ticket auto-reply:', error);
  }
};

// @desc    Submit a new support ticket
// @route   POST /api/support/tickets
// @access  Private
const submitTicket = async (req, res) => {
  try {
    const { subject, message, priority } = req.body;

    if (!subject || !message) {
      return sendError(res, 'Subject and message are required to create a ticket', 400);
    }

    const ticket = new SupportTicket({
      user: req.user._id,
      subject,
      message,
      priority: priority || 'medium'
    });

    await ticket.save();

    // Simulate AI response after 5 seconds
    setTimeout(() => {
      simulateAiResponse(ticket._id);
    }, 5000);

    return successResponse(res, 'Support ticket submitted successfully. Our support team will reply shortly!', {
      ticket
    });
  } catch (error) {
    console.error('submitTicket error:', error);
    return sendError(res, 'Failed to submit support ticket', 500, error);
  }
};

// @desc    Get user's past support tickets (or all tickets if user is admin)
// @route   GET /api/support/tickets
// @access  Private
const getTickets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
    const roleNames = userRoles.map(ur => ur.role?.name?.toUpperCase() || '');
    const isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');

    const filter = isAdmin ? {} : { user: req.user._id };
    const totalItems = await SupportTicket.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    let queryBuilder = SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    if (isAdmin) {
      queryBuilder = queryBuilder.populate('user', 'name email');
    }

    const tickets = await queryBuilder;

    return successResponse(res, 'Support tickets retrieved successfully', {
      tickets,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('getTickets error:', error);
    return sendError(res, 'Failed to fetch support tickets', 500, error);
  }
};

// @desc    Reply to a support ticket
// @route   POST /api/support/tickets/:ticketId/reply
// @access  Private
const replyTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return sendError(res, 'Reply message is required', 400);
    }

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return sendError(res, 'Support ticket not found', 404);
    }

    // Security: Only the ticket owner or an admin can reply
    const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
    const roleNames = userRoles.map(ur => ur.role?.name?.toUpperCase() || '');
    const isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');

    if (ticket.user.toString() !== req.user._id.toString() && !isAdmin) {
      return sendError(res, 'Unauthorized to reply to this ticket', 403);
    }

    // Push reply
    ticket.replies.push({
      sender: req.user._id,
      message: message.trim()
    });

    // Update ticket status
    if (isAdmin) {
      ticket.status = 'answered';
    } else {
      ticket.status = 'open';
    }

    await ticket.save();

    return successResponse(res, 'Reply sent successfully', { ticket });
  } catch (error) {
    console.error('replyTicket error:', error);
    return sendError(res, 'Failed to send reply', 500, error);
  }
};

// @desc    Update ticket status
// @route   PUT /api/support/tickets/:ticketId/status
// @access  Private
const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;

    if (!['open', 'answered', 'closed'].includes(status)) {
      return sendError(res, 'Invalid status selection', 400);
    }

    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return sendError(res, 'Support ticket not found', 404);
    }

    // Only ticket owner or admin can update status
    const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
    const roleNames = userRoles.map(ur => ur.role?.name?.toUpperCase() || '');
    const isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');

    if (ticket.user.toString() !== req.user._id.toString() && !isAdmin) {
      return sendError(res, 'Unauthorized to modify status', 403);
    }

    ticket.status = status;
    await ticket.save();

    return successResponse(res, `Ticket status updated to ${status} successfully`, { ticket });
  } catch (error) {
    console.error('updateTicketStatus error:', error);
    return sendError(res, 'Failed to update ticket status', 500, error);
  }
};

export default {
  submitTicket,
  getTickets,
  replyTicket,
  updateTicketStatus
};
