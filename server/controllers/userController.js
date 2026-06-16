import { z } from "zod";
import { findUserById, listUsers, updateUserProfile } from "../models/User.js";

const avatarSchema = z
  .enum(["crown", "knight", "rook", "pawn", "bishop", "queen"])
  .or(z.string().url().max(500))
  .optional()
  .or(z.literal(""));

export const profileSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
  avatar: avatarSchema
});

export async function getProfile(req, res, next) {
  try {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const user = await updateUserProfile(req.user.id, req.body);
    res.json({ user });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Username is already taken" });
    }
    next(error);
  }
}

export async function leaderboard(req, res, next) {
  try {
    const users = await listUsers({ limit: 100 });
    // If the requester is an admin, return full list; otherwise hide admin accounts
    const isAdmin = req.user && req.user.role === "admin";
    const result = isAdmin ? users : users.filter((u) => u.role !== "admin");
    res.json({ users: result });
  } catch (error) {
    next(error);
  }
}
