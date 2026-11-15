import mongoose, { Document, Schema, Types } from "mongoose";

export interface IConversation extends Document {
  _id: Types.ObjectId;
  participants: Types.ObjectId[];
  lastMessage: string;
  lastMessageTime: Date;
  /** Sorted "a_b" id pair: one conversation per pair, enforced in the DB. */
  pairKey?: string;
  /** Per-user "clear chat": userId -> timestamp of the last clear. */
  clearedFor?: Map<string, Date>;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    participants: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      required: true,
      index: true,
      validate: {
        validator: (v: Types.ObjectId[]) => v.length === 2,
        message: "A conversation must have exactly 2 participants",
      },
    },
    lastMessage: { type: String, default: "" },
    lastMessageTime: { type: Date, default: Date.now },
    pairKey: { type: String },
    clearedFor: { type: Map, of: Date, default: {} },
  },
  { timestamps: true }
);

// Sparse so older rows without a pairKey do not clash with each other.
conversationSchema.index({ pairKey: 1 }, { unique: true, sparse: true });

export default mongoose.model<IConversation>(
  "Conversation",
  conversationSchema
);
