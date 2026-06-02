import mongoose from 'mongoose';

const websitePageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true // e.g. 'about-us', 'terms-and-conditions', 'faq'
    },
    title: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true // Can store HTML or markdown
    }
  },
  {
    timestamps: true,
    collection: 'website_pages'
  }
);

const WebsitePage = mongoose.model('WebsitePage', websitePageSchema);

export default WebsitePage;