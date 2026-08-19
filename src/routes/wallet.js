import { Router } from "express";
import { eq, ilike, desc } from "drizzle-orm";
import { db } from "../config/db.js";
import { wallets, deposits, users, historyLogs } from "../db/schema.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";

// ⚡ IMPORTING YOUR EXACT LOGGER FUNCTION HERE:
import { addHistory } from "../utils/logger.js"; 

const router = Router();

// --- ⚡ ULTRA COMPACT HELPERS ---
const grabW = (tx, uid) =>
  tx.select().from(wallets).where(eq(wallets.userId, uid)).limit(1);

const upW = (tx, uid, data) =>
  tx
    .update(wallets)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(wallets.userId, uid));

const checkAmt = (req, res, next) => {
  req.amt = parseInt(req.body.amount);
  return !req.amt || req.amt <= 0
    ? res.status(400).json({ error: "Invalid amount." })
    : next();
};


// --- 💵 BALANCE & TRANSFER CORES ---
router.get("/balance", verifyToken, async (req, res) => {
  try {
    let [w] = await grabW(db, req.user.userId);
    if (!w)
      [w] = await db
        .insert(wallets)
        .values({ userId: req.user.userId, balance: 0 })
        .returning();
    return res.status(200).json({
      success: true,
      balance: Number(w.balance || 0),
      investmentBalance: Number(w.investmentBalance || 0),
    });
  } catch {
    return res.status(500).json({ error: "Balance fetch failure." });
  }
});

router.post("/transfer-to-invest", verifyToken, checkAmt, async (req, res) => {
  try {
    await db.transaction(async (tx) => {
      const [w] = await grabW(tx, req.user.userId);
      if (!w || Number(w.balance) < req.amt) throw new Error("400");
      await upW(tx, req.user.userId, {
        balance: Number(w.balance) - req.amt,
        investmentBalance: Number(w.investmentBalance) + req.amt,
      });

      // Log transaction safely inside the tx connection block
      await addHistory(tx, req.user.userId, "WALLET", "MOVED_IN", `Allocated investment funds.`, { amount: req.amt });
    });
    return res.status(200).json({ success: true, message: "Moved." });
  } catch (err) {
    return res.status(err.message === "400" ? 400 : 500).json({
      error: err.message === "400" ? "Insufficient funds." : "Failed.",
    });
  }
});

router.post("/transfer-to-main", verifyToken, checkAmt, async (req, res) => {
  try {
    await db.transaction(async (tx) => {
      const [w] = await grabW(tx, req.user.userId);
      if (!w || Number(w.investmentBalance) < req.amt) throw new Error("400");
      await upW(tx, req.user.userId, {
        balance: Number(w.balance) + req.amt,
        investmentBalance: Number(w.investmentBalance) - req.amt,
      });

      // Log transaction safely inside the tx connection block
      await addHistory(tx, req.user.userId, "WALLET", "MOVED_OUT", `Reverted investment funds to main wallet.`, { amount: req.amt });
    });
    return res.status(200).json({ success: true, message: "Reverted." });
  } catch (err) {
    return res.status(err.message === "400" ? 400 : 500).json({
      error: err.message === "400" ? "Insufficient investment funds." : "Failed.",
    });
  }
});

// --- 📥 MANUAL DEPOSIT & P2P PUSH ---
router.post("/deposit/manual", verifyToken, async (req, res) => {
  const { amount, utrNumber } = req.body;
  if (!amount || !utrNumber)
    return res.status(400).json({ error: "Missing fields." });
  try {
    await db.transaction(async (tx) => {
      await tx.insert(deposits).values({
        userId: req.user.userId,
        amount: parseInt(amount),
        utrNumber: String(utrNumber).trim(),
        status: "PENDING",
      });

      // Log submission event inside the tx connection block
      await addHistory(tx, req.user.userId, "DEPOSIT", "SUBMITTED", `Logged a physical manual deposit receipt entry.`, { amount: parseInt(amount), utrNumber });
    });
    return res.status(201).json({ success: true, message: "Logged." });
  } catch (err) {
    return res.status(err.code === "23505" ? 409 : 500).json({ error: "Failed." });
  }
});

router.post("/transfer-to-user", verifyToken, checkAmt, async (req, res) => {
  const { recipientMemberId } = req.body;
  if (!recipientMemberId)
    return res.status(400).json({ error: "Invalid input fields." });
  try {
    const [rU] = await db
      .select()
      .from(users)
      .where(ilike(users.memberId, recipientMemberId.trim()))
      .limit(1);
    if (!rU)
      return res.status(404).json({ error: "Recipient account not found." });
    if (rU.id === req.user.userId)
      return res.status(400).json({ error: "Cannot transfer to yourself." });

    await db.transaction(async (tx) => {
      const [sW] = await grabW(tx, req.user.userId);
      if (!sW || Number(sW.balance) < req.amt) throw new Error("400");
      let [rW] = await grabW(tx, rU.id);
      if (!rW)
        [rW] = await tx
          .insert(wallets)
          .values({ userId: rU.id, balance: 0 })
          .returning();

      await upW(tx, req.user.userId, { balance: Number(sW.balance) - req.amt });
      await upW(tx, rU.id, { balance: Number(rW.balance) + req.amt });

      // Pass the active 'tx' context down so both records track or drop atomically
      await addHistory(tx, req.user.userId, "WALLET", "P2P_SENT", `Sent funds to user (${recipientMemberId}).`, { amount: req.amt, recipient: recipientMemberId });
      await addHistory(tx, rU.id, "WALLET", "P2P_RECEIVED", `Received funds from another player.`, { amount: req.amt, senderId: req.user.userId });
    });
    return res.status(200).json({
      success: true,
      message: `Transferred to ${rU.fullName || "User"}!`,
    });
  } catch (err) {
    return res.status(err.message === "400" ? 400 : 500).json({
      error: err.message === "400" ? "Insufficient main wallet balance." : "Internal transaction failure.",
    });
  }
});

// --- 🛠️ ADMIN CORES ---
router.get(
  "/admin/deposits/pending",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        queue: await db
          .select()
          .from(deposits)
          .where(eq(deposits.status, "PENDING")),
      });
    } catch {
      return res.status(500).json({ error: "Failed." });
    }
  }
);

router.post(
  "/admin/deposits/process",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { depositId, action } = req.body;
    if (!depositId || !["APPROVE", "DECLINE"].includes(action))
      return res.status(400).json({ error: "Invalid parameters." });
    try {
      await db.transaction(async (tx) => {
        const [o] = await tx
          .select()
          .from(deposits)
          .where(eq(deposits.id, depositId))
          .limit(1);
        if (!o || o.status !== "PENDING") throw new Error("400");

        await tx
          .update(deposits)
          .set({
            status: action === "APPROVE" ? "APPROVED" : "DECLINED",
            updatedAt: new Date(),
          })
          .where(eq(deposits.id, depositId));

        if (action === "APPROVE") {
          const [cW] = await grabW(tx, o.userId);
          cW
            ? await upW(tx, o.userId, { balance: Number(cW.balance) + o.amount })
            : await tx.insert(wallets).values({ userId: o.userId, balance: o.amount });
        }

        // Push confirmation history to the customer using 'tx' connection reference
        await addHistory(
          tx, 
          o.userId, 
          "DEPOSIT", 
          action === "APPROVE" ? "APPROVED" : "DECLINED", 
          `Your manual deposit request was ${action === "APPROVE" ? "approved" : "declined"} by an administrator.`, 
          { amount: o.amount, utrNumber: o.utrNumber }
        );
      });
      return res.status(200).json({ success: true, message: "Complete." });
    } catch (err) {
      return res.status(err.message === "400" ? 400 : 500).json({
        error: err.message === "400" ? "Stale transaction." : "Failed.",
      });
    }
  }
);

export default router;
