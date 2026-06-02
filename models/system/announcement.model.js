import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    expiresAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'announcements'
  }
);

const Announcement = mongoose.model('Announcement', announcementSchema);

export default Announcement;