import { Router } from "express";
import { eq, and, like, desc, sql } from "drizzle-orm";
import { db } from "../config/db.js";
import { wallets, investments } from "../db/schema.js";
import { verifyToken } from "../middleware/auth.js";
import { addHistory } from "../utils/logger.js"; // 👈 Import your history utility here

const router = Router();

// --- 💰 1. BATCH INVESTMENT ROUTE ---
router.post("/invest-batch", verifyToken, async (req, res) => {
  const { investments: batchData } = req.body;
  if (!batchData) {
    return res.status(400).json({ error: "Missing investment data." });
  }

  const allowed = ["MIP", "SIP", "INSURANCE", "SHARES", "AGRI"];
  const updates = Object.entries(batchData)
    .map(([planType, raw]) => ({ planType, amt: parseInt(raw) || 0 }))
    .filter(({ planType, amt }) => amt > 0 && allowed.includes(planType));

  const totalCost = updates.reduce((sum, i) => sum + i.amt, 0);
  if (!totalCost) {
    return res.status(400).json({ error: "No valid amounts provided." });
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Verify wallet balance
      const [w] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, req.user.userId))
        .limit(1);

      if (!w || Number(w.investmentBalance) < totalCost) {
        throw new Error("INSUFFICIENT_INVESTMENT_BALANCE");
      }

      // 2. Deduct from wallet balance
      await tx
        .update(wallets)
        .set({
          investmentBalance: Number(w.investmentBalance) - totalCost,
          updatedAt: new Date(),
        })
        .where(eq(wallets.userId, req.user.userId));

      // 3. Allocate allocations to specific investment plans
      for (const { planType, amt } of updates) {
        const [exist] = await tx
          .select()
          .from(investments)
          .where(
            and(
              eq(investments.userId, req.user.userId),
              eq(investments.planType, planType)
            )
          )
          .limit(1);

        if (exist) {
          await tx
            .update(investments)
            .set({ amount: exist.amount + amt, updatedAt: new Date() })
            .where(
              and(
                eq(investments.userId, req.user.userId),
                eq(investments.planType, planType)
              )
            );
        } else {
          await tx
            .insert(investments)
            .values({ userId: req.user.userId, planType, amount: amt });
        }
      }

      // 4. 📝 WRITE TO MASTER LOGBOOK (Using the active 'tx' context)
      await addHistory(
        tx,
        req.user.userId,
        "INVESTMENTS",
        "BATCH_PURCHASE",
        `Successfully processed batch investment of $${totalCost}.`,
        { totalCost, breakdown: updates }
      );
    });

    return res.status(200).json({
      success: true,
      message: "Batch investments applied successfully!",
    });
  } catch (error) {
    console.error("🔴 TRANSACTION CRASH ENGINE DETECTED:", error);

    if (error.message === "INSUFFICIENT_INVESTMENT_BALANCE") {
      return res
        .status(400)
        .json({ error: "Insufficient investment wallet balance." });
    }

    return res.status(500).json({
      error: "Batch investment execution failed.",
      debug: error.message,
    });
  }
});

// --- 📊 2. GET CURRENT PORTFOLIO STATUS ---
router.get("/portfolio", verifyToken, async (req, res) => {
  try {
    const userInvestments = await db
      .select()
      .from(investments)
      .where(eq(investments.userId, req.user.userId));

    const sections = { MIP: 0, SIP: 0, INSURANCE: 0, SHARES: 0, AGRI: 0 };
    let totalInvested = 0;

    userInvestments.forEach((row) => {
      const amount = Number(row.amount) || 0;
      if (sections.hasOwnProperty(row.planType)) {
        sections[row.planType] = amount;
        totalInvested += amount;
      }
    });

    return res
      .status(200)
      .json({ success: true, total: totalInvested, sections });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to compile investment portfolio statistics." });
  }
});

export default router;
