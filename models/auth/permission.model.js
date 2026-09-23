import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, lowercase: true },
  description: { type: String, required: true }
}, { timestamps: true });

export default mongoose.model('Permission', permissionSchema);
