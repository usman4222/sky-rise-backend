import express from 'express';
import {
  getSalaryEligibility,
  requestWeeklySalary,
  getMySalaryRequests
} from '../controllers/weekly_salary.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { financeRateLimiter, requestLockGuard } from '../middleware/security.js';

const router = express.Router();

router.use(firebaseProtect);

router.get('/eligibility', getSalaryEligibility);
router.post('/request', financeRateLimiter, requestLockGuard, requestWeeklySalary);
router.get('/my-requests', getMySalaryRequests);

export default router;
