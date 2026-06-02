import mongoose from 'mongoose';

const teamBonusSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true // The upline user earning the bonus
  },
  joiningMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true // The new member who joined within 5 levels
  },
  level: {
    type: Number,
    required: true,
    min: 1,
    max: 5 // Earn up to 5 levels
  },
  amount: {
    type: Number,
    required: true,
    default: 1 // $1 per member join
  }
}, {
  timestamps: true,
  collection: 'team_bonus'
});

// A user can only earn team bonus once per joining member
teamBonusSchema.index({ user: 1, joiningMember: 1 }, { unique: true });

export default mongoose.model('TeamBonus', teamBonusSchema);
