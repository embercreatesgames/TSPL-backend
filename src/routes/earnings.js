import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../config/db.js";
import { wallets, walletLedger, binaryPoints } from "../db/schema.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

// ─── GET: MLM wallet balance ──────────────────────────────────
router.get("/balance", verifyToken, async (req, res) => {
  try {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, req.user.userId)).limit(1);
    const [points] = await db.select().from(binaryPoints).where(eq(binaryPoints.userId, req.user.userId)).limit(1);
    return res.status(200).json({
      success: true,
      balance: Number(wallet?.mlmBalance || 0),
      leftPoints: points?.leftPoints || 0,
      rightPoints: points?.rightPoints || 0,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch earnings balance." });
  }
});

// ─── GET: Earnings ledger (all MLM transactions) ─────────────
router.get("/ledger", verifyToken, async (req, res) => {
  try {
    const entries = await db
      .select()
      .from(walletLedger)
      .where(eq(walletLedger.userId, req.user.userId))
      .orderBy(desc(walletLedger.createdAt));
    return res.status(200).json({ success: true, ledger: entries });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch ledger." });
  }
});

// ─── GET: Earnings summary ────────────────────────────────────
router.get("/summary", verifyToken, async (req, res) => {
  try {
    const entries = await db.select().from(walletLedger).where(eq(walletLedger.userId, req.user.userId));
    const directTotal = entries.filter(e => e.type === "direct_commission").reduce((s, e) => s + Number(e.amount), 0);
    const matchingTotal = entries.filter(e => e.type === "matching_bonus").reduce((s, e) => s + Number(e.amount), 0);
    return res.status(200).json({
      success: true,
      totalDirectCommission: directTotal,
      totalMatchingBonus: matchingTotal,
      totalEarnings: directTotal + matchingTotal,
      transactionCount: entries.length,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch earnings summary." });
  }
});

export default router;
