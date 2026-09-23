import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    action: {
      type: String,
      required: true,
      index: true // e.g. 'APPROVE_DEPOSIT', 'SUSPEND_USER', 'EDIT_PACKAGE'
    },
    targetModel: {
      type: String,
      required: true // e.g. 'Deposit', 'User', 'InvestmentPackage'
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    oldData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    newData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    ipAddress: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'admin_logs'
  }
);

const AdminLog = mongoose.model('AdminLog', adminLogSchema);

export default AdminLog;