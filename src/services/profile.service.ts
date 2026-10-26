import createHttpError from "http-errors";
import { User } from "../models/users.model.js";
import { toAuthUser, toPublicUser } from "../utils/user-mapper.js";
import type { AuthUser } from "../types/auth.type.js";
import type { UpdateProfileInput } from "../validations/profile.validation.js";

function avatarData(file: Express.Multer.File): string {
  const buffer = file.buffer;
  const valid = (file.mimetype === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimetype === "image/jpeg" && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) ||
    (file.mimetype === "image/gif" && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")));
  if (!valid) throw createHttpError(400, "Avatar content does not match its image type");
  return `data:${file.mimetype};base64,${buffer.toString("base64")}`;
}

export async function updateProfile(actor: AuthUser, input: UpdateProfileInput, file?: Express.Multer.File) {
  const { firstName, lastName, personalEmail, phone, location, bio } = input;
  const avatar = file ? avatarData(file) : input.avatar;
  const user = await User.findOneAndUpdate(
    { _id: actor.id, active: true,
      $or: [{ tokenVersion: actor.tokenVersion ?? 0 }, { tokenVersion: { $exists: false } }] },
    { $set: { firstName, lastName, personalEmail, phone, location, bio,
      ...(avatar !== undefined ? { avatar } : {}) } },
    { returnDocument: 'after', runValidators: true },
  );
  if (!user) throw createHttpError(401, "Session is no longer valid");
  return toPublicUser(toAuthUser(user));
}
