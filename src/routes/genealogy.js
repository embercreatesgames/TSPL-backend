import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../config/db.js";
import { users, binaryPoints } from "../db/schema.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { buildTree, countDownline } from "../services/mlm.service.js";

const router = Router();

// ─── GET: My binary tree (default 3 levels) ──────────────────
router.get("/my-tree", verifyToken, async (req, res) => {
  const depth = parseInt(req.query.depth) || 3;
  try {
    const [user] = await db.select({ memberId: users.memberId }).from(users).where(eq(users.id, req.user.userId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found." });
    const tree = await buildTree(db, user.memberId, Math.min(depth, 6));
    return res.status(200).json({ success: true, tree });
  } catch (error) {
    console.error("My Tree Error:", error);
    return res.status(500).json({ error: "Failed to fetch tree." });
  }
});

// ─── GET: User's binary points ────────────────────────────────
router.get("/my-points", verifyToken, async (req, res) => {
  try {
    const [points] = await db.select().from(binaryPoints).where(eq(binaryPoints.userId, req.user.userId)).limit(1);
    return res.status(200).json({
      success: true,
      leftPoints: points?.leftPoints || 0,
      rightPoints: points?.rightPoints || 0,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch points." });
  }
});

// ─── GET: Downline count (full recursive) ──────────────────────
router.get("/downline-count", verifyToken, async (req, res) => {
  try {
    const [user] = await db.select({ memberId: users.memberId }).from(users).where(eq(users.id, req.user.userId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found." });
    const counts = await countDownline(db, user.memberId);
    return res.status(200).json({ success: true, ...counts });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch downline count." });
  }
});

// ─── GET: View any user's tree (for genealogy navigation) ────
router.get("/view-tree/:memberId", verifyToken, async (req, res) => {
  const depth = parseInt(req.query.depth) || 3;
  try {
    const tree = await buildTree(db, req.params.memberId.toUpperCase(), Math.min(depth, 6));
    if (!tree) return res.status(404).json({ error: "User not found." });
    return res.status(200).json({ success: true, tree });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch tree." });
  }
});

// ─── ADMIN: Global network viewer ─────────────────────────────
router.get("/admin/global-tree/:memberId", verifyToken, verifyAdmin, async (req, res) => {
  const depth = parseInt(req.query.depth) || 4;
  try {
    const tree = await buildTree(db, req.params.memberId.toUpperCase(), depth);
    if (!tree) return res.status(404).json({ error: "User not found." });
    return res.status(200).json({ success: true, tree });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch global tree." });
  }
});

export default router;
