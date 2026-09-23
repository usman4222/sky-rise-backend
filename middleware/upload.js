import multer from 'multer';
import { sendError } from '../utils/response.js';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimetypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedMimetypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, JPEG, PNG, and WEBP image formats are allowed.'), false);
  }
};

const uploadConfig = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: fileFilter
}).single('image');

export const uploadImageMiddleware = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  uploadConfig(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 'File size limit exceeded. Max size allowed is 5MB.', 400);
      }
      return sendError(res, err.message, 400);
    }
    next();
  });
};
