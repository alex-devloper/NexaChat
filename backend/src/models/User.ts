import mongoose, { Document, Schema, Types } from "mongoose";

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  username: string;
  email: string;
  password: string;
  about: string;
  profilePic: string;
  isOnline: boolean;
  lastSeen: Date;
  showLastSeen: boolean;
  blocked: Types.ObjectId[];
  resetTokenHash?: string | null;
  resetTokenExpiry?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: { type: String, required: true },
    about: { type: String, default: "" },
    profilePic: { type: String, default: "" },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    showLastSeen: { type: Boolean, default: true },
    blocked: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    resetTokenHash: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
  },
  { timestamps: true }
);

export function toPublicUser(user: IUser) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    about: user.about || "",
    profilePic: user.profilePic || "",
    isOnline: !!user.isOnline,
    lastSeen: user.lastSeen,
    showLastSeen: user.showLastSeen !== false,
  };
}

export default mongoose.model<IUser>("User", userSchema);
