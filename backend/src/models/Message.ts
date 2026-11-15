import mongoose, { Document, Schema, Types } from "mongoose";

export interface IMessage extends Document {
  _id: Types.ObjectId;
  conversation: Types.ObjectId;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  message: string;
  deliveredAt?: Date | null;
  seenAt?: Date | null;
  isDeletedForEveryone: boolean;
  deletedFor: Types.ObjectId[];
  replyToId?: Types.ObjectId | null;
  replyText?: string | null;
  replyToSelf?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiver: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: { type: String, required: true },
    deliveredAt: { type: Date, default: null },
    seenAt: { type: Date, default: null },
    isDeletedForEveryone: { type: Boolean, default: false },
    deletedFor: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    replyToId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    replyText: { type: String, default: null },
    replyToSelf: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: 1 });

export default mongoose.model<IMessage>("Message", messageSchema);
