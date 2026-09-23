import express from 'express';
import {
  addPaymentMethod,
  getMyPaymentMethods,
  updatePaymentMethod,
  deletePaymentMethod,
  setDefaultPaymentMethod
} from '../controllers/payment_method.controller.js';
import { firebaseProtect } from '../middleware/firebaseAuth.js';

const router = express.Router();

// Apply auth protection to all routes
router.use(firebaseProtect);

router.post('/', addPaymentMethod);
router.get('/my', getMyPaymentMethods);
router.put('/:id', updatePaymentMethod);
router.delete('/:id', deletePaymentMethod);
router.patch('/:id/default', setDefaultPaymentMethod);

export default router;
