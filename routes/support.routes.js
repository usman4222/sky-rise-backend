import express from 'express';
import supportController from '../controllers/support.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';

const { submitTicket, getTickets, replyTicket, updateTicketStatus } = supportController;
const router = express.Router();

router.post('/tickets', firebaseProtect, submitTicket);
router.get('/tickets', firebaseProtect, getTickets);
router.post('/tickets/:ticketId/reply', firebaseProtect, replyTicket);
router.put('/tickets/:ticketId/status', firebaseProtect, updateTicketStatus);

export default router;
