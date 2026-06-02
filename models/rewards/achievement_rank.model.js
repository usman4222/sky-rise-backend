import mongoose from 'mongoose';

const achievementRankSchema = new mongoose.Schema({
  stage: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 10,
    index: true
  },
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  requiredTeamBusiness: {
    type: Number,
    required: true // 5-level total business volume target
  },
  reward: {
    type: Number,
    required: true // One-time cash bonus reward
  }
}, {
  timestamps: true,
  collection: 'achievement_ranks'
});

export default mongoose.model('AchievementRank', achievementRankSchema);
