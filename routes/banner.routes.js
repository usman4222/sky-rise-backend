import express from 'express';
import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { restrictTo } from '../middleware/rbac.js';
import { uploadImageMiddleware } from '../middleware/upload.js';
import {
  getBanners,
  createBanner,
  updateBanner,
  deleteBanner
} from '../controllers/banner.controller.js';

const router = express.Router();

// Public/authenticated route to fetch banners
router.get('/', firebaseProtect, getBanners);

// Protected admin banner management routes
router.post('/', firebaseProtect, restrictTo('ADMIN', 'SUPER_ADMIN'), uploadImageMiddleware, createBanner);
router.put('/:id', firebaseProtect, restrictTo('ADMIN', 'SUPER_ADMIN'), uploadImageMiddleware, updateBanner);
router.delete('/:id', firebaseProtect, restrictTo('ADMIN', 'SUPER_ADMIN'), deleteBanner);

export default router;
