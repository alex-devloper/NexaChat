import mongoose, { Document, Schema, Types } from "mongoose";

export interface IPushSubscription extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: { type: String, required: true, unique: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model<IPushSubscription>(
  "PushSubscription",
  pushSubscriptionSchema
);
