import SupportTicket from '../models/system/support_ticket.model.js';
import UserRole from '../models/auth/user_role.model.js';
import { sendError, successResponse } from '../utils/response.js';

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
    const userRoles = await UserRole.find({ user: req.user._id }).populate('role');
    const roleNames = userRoles.map(ur => ur.role?.name?.toUpperCase() || '');
    const isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');

    let tickets;
    if (isAdmin) {
      tickets = await SupportTicket.find({})
        .populate('user', 'name email')
        .sort({ createdAt: -1 });
    } else {
      tickets = await SupportTicket.find({ user: req.user._id })
        .sort({ createdAt: -1 });
    }

    return successResponse(res, 'Support tickets retrieved successfully', {
      tickets
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
