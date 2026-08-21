import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../config/db.js";
import { epins, epinPurchases, users, wallets } from "../db/schema.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { generatePinCode } from "../services/mlm.service.js";
import { addHistory } from "../utils/logger.js";

const router = Router();

// ─── PUBLIC: Buy E-PIN (guest, pre-registration) ─────────────
router.post("/public-purchase", async (req, res) => {
  const { amount, email, paymentRef } = req.body;
  if (!amount || !email || !paymentRef) {
    return res.status(400).json({ error: "amount, email, and paymentRef are required." });
  }
  try {
    const pinCode = generatePinCode();
    await db.insert(epins).values({ pinCode, status: "active" });
    await db.insert(epinPurchases).values({
      amount: parseInt(amount),
      paymentMethod: "online",
      paymentRef: paymentRef.trim(),
      status: "completed",
    });
    return res.status(201).json({ success: true, pinCode, message: "E-PIN purchased successfully. Check your email." });
  } catch (error) {
    console.error("Public E-PIN Purchase Error:", error);
    return res.status(500).json({ error: "Failed to process E-PIN purchase." });
  }
});

// ─── AUTHENTICATED: Buy E-PIN (member via wallet) ────────────
router.post("/member-purchase", verifyToken, async (req, res) => {
  const { quantity } = req.body;
  const qty = parseInt(quantity) || 1;
  const PIN_COST = 200;
  const totalCost = PIN_COST * qty;
  try {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, req.user.userId)).limit(1);
    if (!wallet || Number(wallet.balance) < totalCost) {
      return res.status(400).json({ error: `Insufficient balance. Need ₹${totalCost}.` });
    }
    await db.transaction(async (tx) => {
      await tx.update(wallets).set({ balance: Number(wallet.balance) - totalCost, updatedAt: new Date() }).where(eq(wallets.userId, req.user.userId));
      const pinCodes = [];
      for (let i = 0; i < qty; i++) {
        const code = generatePinCode();
        await tx.insert(epins).values({ pinCode: code, status: "active", generatedByUserId: req.user.userId });
        pinCodes.push(code);
      }
      await addHistory(tx, req.user.userId, "MLM", "EPIN_PURCHASE", `Purchased ${qty} E-PIN(s) for ₹${totalCost}.`, { pinCodes, totalCost });
    });
    return res.status(201).json({ success: true, pins: qty, message: `${qty} E-PIN(s) generated successfully.` });
  } catch (error) {
    console.error("Member E-PIN Purchase Error:", error);
    return res.status(500).json({ error: "Failed to process E-PIN purchase." });
  }
});

// ─── VALIDATE E-PIN (pre-registration check) ─────────────────
router.get("/validate/:pinCode", async (req, res) => {
  const { pinCode } = req.params;
  try {
    const [pin] = await db.select().from(epins).where(eq(epins.pinCode, pinCode.toUpperCase().trim())).limit(1);
    if (!pin) return res.status(404).json({ valid: false, error: "E-PIN not found." });
    if (pin.status !== "active") return res.status(400).json({ valid: false, error: "E-PIN already used." });
    return res.status(200).json({ valid: true, pinCode: pin.pinCode });
  } catch (error) {
    return res.status(500).json({ valid: false, error: "Validation failed." });
  }
});

// ─── VALIDATE REFERRAL ID ────────────────────────────────────
router.get("/validate-referral/:memberId", async (req, res) => {
  const { memberId } = req.params;
  try {
    const [user] = await db.select({ memberId: users.memberId, fullName: users.fullName }).from(users).where(eq(users.memberId, memberId.toUpperCase().trim())).limit(1);
    if (!user) return res.status(404).json({ valid: false, error: "Referral ID not found." });
    return res.status(200).json({ valid: true, memberId: user.memberId, name: user.fullName });
  } catch (error) {
    return res.status(500).json({ valid: false, error: "Validation failed." });
  }
});

// ─── ADMIN: Generate bulk E-PINs ─────────────────────────────
router.post("/admin/generate", verifyToken, verifyAdmin, async (req, res) => {
  const { quantity } = req.body;
  const qty = parseInt(quantity) || 10;
  try {
    const pinCodes = [];
    await db.transaction(async (tx) => {
      for (let i = 0; i < qty; i++) {
        const code = generatePinCode();
        await tx.insert(epins).values({ pinCode: code, status: "active", generatedByUserId: req.user.userId });
        pinCodes.push(code);
      }
    });
    return res.status(201).json({ success: true, count: pinCodes.length, pins: pinCodes });
  } catch (error) {
    console.error("Admin E-PIN Generate Error:", error);
    return res.status(500).json({ error: "Failed to generate E-PINs." });
  }
});

// ─── ADMIN: List all E-PINs ──────────────────────────────────
router.get("/admin/list", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const allPins = await db.select().from(epins);
    return res.status(200).json({ success: true, pins: allPins });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch E-PINs." });
  }
});

export default router;
