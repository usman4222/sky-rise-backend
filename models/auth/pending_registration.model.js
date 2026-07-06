import mongoose from 'mongoose';

const pendingRegistrationSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String
  },
  sponsorCode: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 172800 // Automatically purge after 48 hours (in seconds)
  }
});

export default mongoose.model('PendingRegistration', pendingRegistrationSchema);
