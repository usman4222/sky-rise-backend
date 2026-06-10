import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      required: true
    },
    publicId: {
      type: String,
      required: false
    },
    title: {
      type: String,
      trim: true,
      default: ''
    },
    link: {
      type: String,
      trim: true,
      default: ''
    },
    isActive: {
      type: Boolean,
      default: true
    },
    order: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true,
    collection: 'banners'
  }
);

const Banner = mongoose.model('Banner', bannerSchema);

export default Banner;
