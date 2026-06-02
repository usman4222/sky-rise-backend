import express from 'express';
import webhookController from '../controllers/webhook.controller.js';

const router = express.Router();
const { handleCoinPaymentsIPN } = webhookController;

// CoinPayments webhook IPN route - Public route verified via HMAC signature
router.post('/coinpayments', handleCoinPaymentsIPN);

export default router;
