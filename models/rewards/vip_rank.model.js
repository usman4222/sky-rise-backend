import mongoose from 'mongoose';

const vipRankSchema = new mongoose.Schema({
  level: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 5,
    index: true
  },
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  requiredActiveLegs: {
    type: Number,
    default: 5
  },
  requiredBusinessPerLeg: {
    type: Number,
    required: true // e.g. 1000, 2000, 4000, 8000, 16000
  },
  weeklySalary: {
    type: Number,
    required: true // e.g. 50, 100, 200, 400, 800
  }
}, {
  timestamps: true,
  collection: 'vip_ranks'
});

export default mongoose.model('VipRank', vipRankSchema);
