import Banner from '../models/system/banner.model.js';
import UserRole from '../models/auth/user_role.model.js';
import cloudinary from '../config/cloudinary.js';
import { sendError, successResponse } from '../utils/response.js';

const streamUpload = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'skyrise_banners',
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

export const getBanners = async (req, res) => {
  try {
    const user = req.user;
    
    // Query UserRole to check if user has admin privileges
    const userRoles = await UserRole.find({ user: user?._id }).populate('role');
    const roleNames = userRoles.map(ur => ur.role?.name).filter(Boolean);
    const isAdmin = roleNames.includes('ADMIN') || roleNames.includes('SUPER_ADMIN');

    console.log(`[getBanners] User: ${user?._id}, Roles: [${roleNames.join(', ')}], isAdmin: ${isAdmin}`);

    let query = {};
    if (!isAdmin) {
      query.isActive = true;
    }

    const banners = await Banner.find(query).sort({ order: 1, createdAt: -1 });

    return successResponse(res, 'Banners retrieved successfully', { banners });
  } catch (error) {
    console.error('Error fetching banners:', error);
    return sendError(res, 'Failed to retrieve banners', 500, error);
  }
};

export const createBanner = async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 'No banner image file provided', 400);
    }

    const { title, link, order, isActive } = req.body;

    let cloudinaryResult;
    try {
      cloudinaryResult = await streamUpload(req.file.buffer);
    } catch (uploadError) {
      console.error('Cloudinary upload error for banner:', uploadError);
      return sendError(res, 'Failed to upload image to Cloudinary', 500, uploadError);
    }

    const { secure_url, public_id } = cloudinaryResult;

    const banner = await Banner.create({
      imageUrl: secure_url,
      publicId: public_id,
      title: title || '',
      link: link || '',
      order: order ? parseInt(order, 10) : 0,
      isActive: isActive === 'false' ? false : true
    });

    return successResponse(res, 'Banner created successfully', { banner }, 201);
  } catch (error) {
    console.error('Error creating banner:', error);
    return sendError(res, 'Failed to create banner', 500, error);
  }
};

export const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, link, order, isActive } = req.body;

    const banner = await Banner.findById(id);
    if (!banner) {
      return sendError(res, 'Banner not found', 404);
    }

    // If new image file is uploaded
    if (req.file) {
      // 1. Upload new image
      let cloudinaryResult;
      try {
        cloudinaryResult = await streamUpload(req.file.buffer);
      } catch (uploadError) {
        console.error('Cloudinary upload error during update:', uploadError);
        return sendError(res, 'Failed to upload new banner image to Cloudinary', 500, uploadError);
      }

      // 2. Delete old image from Cloudinary
      if (banner.publicId) {
        try {
          await cloudinary.uploader.destroy(banner.publicId);
        } catch (destroyError) {
          console.warn('Failed to delete old image from Cloudinary:', destroyError.message);
        }
      }

      banner.imageUrl = cloudinaryResult.secure_url;
      banner.publicId = cloudinaryResult.public_id;
    }

    if (title !== undefined) banner.title = title;
    if (link !== undefined) banner.link = link;
    if (order !== undefined) banner.order = parseInt(order, 10);
    if (isActive !== undefined) {
      banner.isActive = String(isActive) === 'true';
    }

    await banner.save();

    return successResponse(res, 'Banner updated successfully', { banner });
  } catch (error) {
    console.error('Error updating banner:', error);
    return sendError(res, 'Failed to update banner', 500, error);
  }
};

export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;

    const banner = await Banner.findById(id);
    if (!banner) {
      return sendError(res, 'Banner not found', 404);
    }

    // Delete image from Cloudinary
    if (banner.publicId) {
      try {
        await cloudinary.uploader.destroy(banner.publicId);
      } catch (destroyError) {
        console.warn('Failed to delete banner image from Cloudinary:', destroyError.message);
      }
    }

    await Banner.findByIdAndDelete(id);

    return successResponse(res, 'Banner deleted successfully');
  } catch (error) {
    console.error('Error deleting banner:', error);
    return sendError(res, 'Failed to delete banner', 500, error);
  }
};
