import mongoose from 'mongoose';

const uploadedImageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    secureUrl: {
      type: String,
      required: true
    },
    publicId: {
      type: String,
      required: true
    },
    originalName: {
      type: String
    },
    mimeType: {
      type: String
    },
    size: {
      type: Number
    }
  },
  {
    timestamps: true,
    collection: 'uploaded_images'
  }
);

const UploadedImage = mongoose.model('UploadedImage', uploadedImageSchema);

export default UploadedImage;
