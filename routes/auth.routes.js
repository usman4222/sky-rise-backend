import express from 'express';
const router = express.Router();

import authController from '../controllers/auth.controller.js';
const { register, login, logout, getProfile, submitKyc } = authController;

import { protect } from '../middleware/auth.js';

// Public Routes
router.post('/register', register);
router.post('/login', login);

// Private Routes (Require Session JWT)
router.post('/logout', protect, logout);
router.get('/profile', protect, getProfile);
router.post('/kyc', protect, submitKyc);

export default router;
