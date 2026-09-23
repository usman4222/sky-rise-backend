import express from 'express';
import { firebaseProtect } from '../middleware/firebaseAuth.js';
import { uploadImageMiddleware } from '../middleware/upload.js';
import cloudinary from '../config/cloudinary.js';
import UploadedImage from '../models/system/uploaded_image.model.js';
import User from '../models/auth/user.model.js';
import { sendError, successResponse } from '../utils/response.js';

const router = express.Router();

const streamUpload = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'skyrise_profiles',
        resource_type: 'auto'
      },
      (error, result) => {
        if (result) {
          resolve(result);
        } else {
          reject(error);
        }
      }
    );
    stream.end(fileBuffer);
  });
};

router.post('/image', firebaseProtect, uploadImageMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 'No image file provided', 400);
    }

    const user = req.user;
    
    // Upload image to Cloudinary
    let cloudinaryResult;
    try {
      cloudinaryResult = await streamUpload(req.file.buffer);
    } catch (uploadError) {
      console.error('Cloudinary upload error:', uploadError);
      return sendError(res, 'Failed to upload image to Cloudinary', 500, uploadError);
    }

    const { secure_url, public_id } = cloudinaryResult;

    // Save metadata in MongoDB
    let uploadedImage;
    try {
      uploadedImage = await UploadedImage.create({
        user: user._id,
        secureUrl: secure_url,
        publicId: public_id,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      });
    } catch (dbError) {
      console.error('Database save error for UploadedImage:', dbError);
      return sendError(res, 'Failed to save image metadata to database', 500, dbError);
    }

    // Update User Profile document in MongoDB
    try {
      user.imageUrl = secure_url;
      user.imagePublicId = public_id;
      await user.save();
    } catch (userSaveError) {
      console.error('Database save error for User profile:', userSaveError);
      return sendError(res, 'Failed to update user profile image in database', 500, userSaveError);
    }

    return successResponse(res, 'Image uploaded and profile updated successfully', {
      secure_url,
      public_id,
      imageUrl: secure_url,
      uploadedImage
    }, 201);

  } catch (error) {
    console.error('Image upload controller error:', error);
    return sendError(res, 'Internal server error during image upload', 500, error);
  }
});

export default router;
