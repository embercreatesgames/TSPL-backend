import { Router } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../config/db.js";
import { historyLogs } from "../db/schema.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

// --- 📊 TAB 1: ALL HISTORY MIXED ---
// GET /history/all
router.get("/all", verifyToken, async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(historyLogs)
      .where(eq(historyLogs.userId, req.user.userId))
      .orderBy(desc(historyLogs.createdAt));

    return res.status(200).json({ success: true, history: logs });
  } catch {
    return res.status(500).json({ error: "Failed to fetch master history feed." });
  }
});

// --- 💵 TAB 2: WALLET RELATED TRANSACTIONS ---
// GET /history/wallet
router.get("/wallet", verifyToken, async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.userId, req.user.userId),
          eq(historyLogs.feature, "WALLET") // ⚡ Strictly wallet features
        )
      )
      .orderBy(desc(historyLogs.createdAt));

    return res.status(200).json({ success: true, history: logs });
  } catch {
    return res.status(500).json({ error: "Failed to fetch wallet transaction history." });
  }
});

// --- 📈 TAB 3: INVESTMENT RELATED TRANSACTIONS ---
// GET /history/investments
router.get("/investments", verifyToken, async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.userId, req.user.userId),
          eq(historyLogs.feature, "INVESTMENTS") // ⚡ Pluralized to match your transaction logic perfectly!
        )
      )
      .orderBy(desc(historyLogs.createdAt));

    return res.status(200).json({ success: true, history: logs });
  } catch {
    return res.status(500).json({ error: "Failed to fetch investment history." });
  }
});

// --- 🏦 TAB 4: DEPOSITS RELATED HISTORY ---
// GET /history/deposits
router.get("/deposits", verifyToken, async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.userId, req.user.userId),
          eq(historyLogs.feature, "DEPOSIT") // ⚡ Strictly manual deposit features
        )
      )
      .orderBy(desc(historyLogs.createdAt));

    return res.status(200).json({ success: true, history: logs });
  } catch {
    return res.status(500).json({ error: "Failed to fetch deposit history." });
  }
});

// --- 💼 TAB 5: LOAN RELATED TRANSACTIONS (Future Proofing) ---
// GET /history/loans
router.get("/loans", verifyToken, async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(historyLogs)
      .where(
        and(
          eq(historyLogs.userId, req.user.userId),
          eq(historyLogs.feature, "LOAN") // ⚡ Ready for your loan feature additions!
        )
      )
      .orderBy(desc(historyLogs.createdAt));

    return res.status(200).json({ success: true, history: logs });
  } catch {
    return res.status(500).json({ error: "Failed to fetch loan history." });
  }
});

export default router;
