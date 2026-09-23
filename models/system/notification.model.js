import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    category: {
      type: String,
      enum: ['deposit', 'withdrawal', 'investment', 'roi', 'commission', 'rank', 'system'],
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'notifications'
  }
);

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;