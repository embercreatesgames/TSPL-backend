import { eq, and, isNull, or } from "drizzle-orm";
import { db } from "../config/db.js";
import { users, binaryPoints, wallets, walletLedger } from "../db/schema.js";
import { addHistory } from "../utils/logger.js";

const BV_PER_REGISTRATION = 100;
const MATCHING_BONUS_PERCENT = 10;
const DAILY_MATCHING_CAP = 50000;

// ─── Find empty slot in a user's subtree ─────────────────────
export async function findEmptySlot(tx, memberId, position) {
  const [current] = await tx
    .select({ id: users.id, memberId: users.memberId })
    .from(users)
    .where(eq(users.memberId, memberId))
    .limit(1);
  if (!current) return null;

  const [leftChild] = await tx
    .select()
    .from(users)
    .where(and(eq(users.parentId, current.memberId), eq(users.binaryPosition, "left")))
    .limit(1);
  const [rightChild] = await tx
    .select()
    .from(users)
    .where(and(eq(users.parentId, current.memberId), eq(users.binaryPosition, "right")))
    .limit(1);

  if (position === "left") {
    if (!leftChild) return { parentId: current.memberId, position: "left" };
    if (!rightChild) return { parentId: current.memberId, position: "right" };
    return findEmptySlot(tx, leftChild.memberId, "left");
  } else {
    if (!rightChild) return { parentId: current.memberId, position: "right" };
    if (!leftChild) return { parentId: current.memberId, position: "left" };
    return findEmptySlot(tx, rightChild.memberId, "right");
  }
}

// ─── Get all ancestors with the side each child is on ─────────
export async function getAncestors(tx, memberId) {
  const ancestors = [];
  let currentId = memberId;
  while (currentId) {
    const [user] = await tx
      .select({ parentId: users.parentId, memberId: users.memberId, binaryPosition: users.binaryPosition })
      .from(users)
      .where(eq(users.memberId, currentId))
      .limit(1);
    if (!user || !user.parentId) break;
    const [ancestor] = await tx
      .select()
      .from(users)
      .where(eq(users.memberId, user.parentId))
      .limit(1);
    if (!ancestor) break;
    ancestors.push({ ...ancestor, childPosition: user.binaryPosition });
    currentId = ancestor.memberId;
  }
  return ancestors;
}

// ─── Add BV points to ancestor ───────────────────────────────
export async function addBvPoints(tx, ancestorMemberId, position) {
  const [ancestor] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.memberId, ancestorMemberId))
    .limit(1);
  if (!ancestor) return;

  const [existing] = await tx
    .select()
    .from(binaryPoints)
    .where(eq(binaryPoints.userId, ancestor.id))
    .limit(1);

  if (existing) {
    const updateData = position === "left"
      ? { leftPoints: existing.leftPoints + BV_PER_REGISTRATION }
      : { rightPoints: existing.rightPoints + BV_PER_REGISTRATION };
    await tx.update(binaryPoints).set({ ...updateData, updatedAt: new Date() }).where(eq(binaryPoints.userId, ancestor.id));
  } else {
    await tx.insert(binaryPoints).values({
      userId: ancestor.id,
      leftPoints: position === "left" ? BV_PER_REGISTRATION : 0,
      rightPoints: position === "right" ? BV_PER_REGISTRATION : 0,
    });
  }
}

// ─── Process matching bonus for a single user ────────────────
export async function processMatchingBonus(tx, userId, userMemberId) {
  const [points] = await tx
    .select()
    .from(binaryPoints)
    .where(eq(binaryPoints.userId, userId))
    .limit(1);
  if (!points) return { matched: 0, bonus: 0 };

  const matchAmount = Math.min(points.leftPoints, points.rightPoints);
  if (matchAmount <= 0) return { matched: 0, bonus: 0 };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayPayouts = await tx
    .select()
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.userId, userId),
        eq(walletLedger.type, "matching_bonus"),
        eq(walletLedger.description, "daily_cap_check")
      )
    );
  const todayTotal = todayPayouts.reduce((sum, r) => sum + Number(r.amount), 0);
  const remainingCap = Math.max(0, DAILY_MATCHING_CAP - todayTotal);
  const bonus = Math.min(Math.floor((matchAmount * MATCHING_BONUS_PERCENT) / 100), remainingCap);
  if (bonus <= 0) return { matched: 0, bonus: 0 };

  const [wallet] = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (wallet) {
    await tx.update(wallets).set({ balance: Number(wallet.balance) + bonus, updatedAt: new Date() }).where(eq(wallets.userId, userId));
  } else {
    await tx.insert(wallets).values({ userId, balance: bonus });
  }

  await tx.insert(walletLedger).values({ userId, amount: bonus, type: "matching_bonus", description: `10% matching on ${matchAmount} BV matched volume` });

  await tx
    .update(binaryPoints)
    .set({ leftPoints: points.leftPoints - matchAmount, rightPoints: points.rightPoints - matchAmount, updatedAt: new Date() })
    .where(eq(binaryPoints.userId, userId));

  await addHistory(tx, userId, "MLM", "MATCHING_BONUS", `Binary matching bonus of ₹${bonus} credited (matched volume: ${matchAmount} BV).`, { matched: matchAmount, bonus });

  return { matched: matchAmount, bonus };
}

// ─── Award direct referral commission ─────────────────────────
export async function awardDirectReferral(tx, sponsorUserId, newUserId, newMemberId) {
  const DIRECT_BONUS = 500;
  const [wallet] = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, sponsorUserId))
    .limit(1);
  if (wallet) {
    await tx.update(wallets).set({ balance: Number(wallet.balance) + DIRECT_BONUS, updatedAt: new Date() }).where(eq(wallets.userId, sponsorUserId));
  } else {
    await tx.insert(wallets).values({ userId: sponsorUserId, balance: DIRECT_BONUS });
  }
  await tx.insert(walletLedger).values({ userId: sponsorUserId, amount: DIRECT_BONUS, type: "direct_commission", description: `Direct referral bonus for sponsoring ${newMemberId}` });
  await addHistory(tx, sponsorUserId, "MLM", "DIRECT_REFERRAL", `Direct referral bonus of ₹${DIRECT_BONUS} for sponsoring ${newMemberId}.`, { newUserId, directBonus: DIRECT_BONUS });
}

// ─── Full placement + commission chain ────────────────────────
export async function placeNewUserAndProcessCommissions(tx, newUserId, newMemberId, sponsorMemberId) {
  const [sponsor] = await tx
    .select()
    .from(users)
    .where(eq(users.memberId, sponsorMemberId))
    .limit(1);
  if (!sponsor) throw new Error("Sponsor not found");

  const position = sponsor.legPreference || "right";
  const slot = await findEmptySlot(tx, sponsorMemberId, position);
  if (!slot) throw new Error("No available slot in this branch");

  await tx
    .update(users)
    .set({ parentId: slot.parentId, binaryPosition: slot.position, sponsorId: sponsorMemberId, updatedAt: new Date() })
    .where(eq(users.id, newUserId));

  await tx.insert(binaryPoints).values({ userId: newUserId, leftPoints: 0, rightPoints: 0 });

  await awardDirectReferral(tx, sponsor.id, newUserId, newMemberId);

  const ancestors = await getAncestors(tx, newMemberId);
  for (const ancestor of ancestors) {
    await addBvPoints(tx, ancestor.memberId, ancestor.childPosition);
    await processMatchingBonus(tx, ancestor.id, ancestor.memberId);
  }

  return { parentSlot: slot, ancestorsProcessed: ancestors.length };
}

// ─── Build tree for visualization ────────────────────────────
export async function buildTree(tx, memberId, depth = 3) {
  if (depth <= 0) return null;
  const [node] = await tx
    .select({
      id: users.id,
      memberId: users.memberId,
      fullName: users.fullName,
      createdAt: users.createdAt,
      kycStatus: users.kycStatus,
    })
    .from(users)
    .where(eq(users.memberId, memberId))
    .limit(1);
  if (!node) return null;

  const [points] = await tx
    .select()
    .from(binaryPoints)
    .where(eq(binaryPoints.userId, node.id))
    .limit(1);

  const [leftChild] = await tx
    .select({ memberId: users.memberId })
    .from(users)
    .where(and(eq(users.parentId, memberId), eq(users.binaryPosition, "left")))
    .limit(1);
  const [rightChild] = await tx
    .select({ memberId: users.memberId })
    .from(users)
    .where(and(eq(users.parentId, memberId), eq(users.binaryPosition, "right")))
    .limit(1);

  return {
    ...node,
    leftPoints: points?.leftPoints || 0,
    rightPoints: points?.rightPoints || 0,
    left: leftChild ? await buildTree(tx, leftChild.memberId, depth - 1) : null,
    right: rightChild ? await buildTree(tx, rightChild.memberId, depth - 1) : null,
  };
}

// ─── Generate secure E-PIN code ──────────────────────────────
export function generatePinCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
