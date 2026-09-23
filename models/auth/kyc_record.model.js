import mongoose from 'mongoose';

const kycRecordSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true, // Only one active KYC record per user
    index: true
  },
  documentType: {
    type: String,
    enum: ['cnic', 'passport', 'national_id', 'driving_license'],
    required: true
  },
  documentNumber: {
    type: String,
    required: true,
    trim: true
  },
  documentFrontUrl: {
    type: String,
    required: true
  },
  documentBackUrl: {
    type: String,
    default: null // Optional if passport is used
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  remarks: {
    type: String,
    default: ''
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  collection: 'kyc_records'
});

export default mongoose.model('KycRecord', kycRecordSchema);
