import pg from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

const BV = 100;
const DIRECT_BONUS = 500;
const MATCHING_PCT = 10;

// [name, sponsorMemberId, legPreference]
const TEST_USERS = [
  ["Rahul",   "MARUP000001", "right"],
  ["Priya",   "MARUP000001", "left"],
  ["Amit",    "MARUP000002", "right"],
  ["Sneha",   "MARUP000002", "left"],
  ["Vikram",  "MARUP000003", "right"],
  ["Anjali",  "MARUP000003", "left"],
  ["Rohan",   "MARUP000004", "right"],
  ["Meera",   "MARUP000004", "left"],
  ["Karan",   "MARUP000005", "right"],
  ["Nisha",   "MARUP000005", "left"],
  ["Deepak",  "MARUP000006", "right"],
  ["Pooja",   "MARUP000006", "left"],
  ["Arjun",   "MARUP000008", "right"],
  ["Riya",    "MARUP000008", "left"],
  ["Suresh",  "MARUP000010", "right"],
];

function mid(n) {
  return "MARUP" + String(n).padStart(6, "0");
}

async function findEmptySlot(c, memberId, position, depth) {
  if (depth > 20) return null;
  const { rows } = await c.query(
    "SELECT id, member_id FROM users WHERE member_id = $1",
    [memberId]
  );
  if (!rows.length) return null;
  const current = rows[0];

  const left = await c.query(
    "SELECT member_id FROM users WHERE parent_id = $1 AND binary_position = 'left' LIMIT 1",
    [current.member_id]
  );
  const right = await c.query(
    "SELECT member_id FROM users WHERE parent_id = $1 AND binary_position = 'right' LIMIT 1",
    [current.member_id]
  );

  if (position === "left") {
    if (!left.rows.length) return { parentId: current.member_id, pos: "left" };
    if (!right.rows.length) return { parentId: current.member_id, pos: "right" };
    return findEmptySlot(c, left.rows[0].member_id, "left", depth + 1);
  } else {
    if (!right.rows.length) return { parentId: current.member_id, pos: "right" };
    if (!left.rows.length) return { parentId: current.member_id, pos: "left" };
    return findEmptySlot(c, right.rows[0].member_id, "right", depth + 1);
  }
}

async function getAncestors(c, memberId) {
  const ancestors = [];
  let cur = memberId;
  while (cur) {
    const { rows } = await c.query(
      "SELECT parent_id, member_id, binary_position FROM users WHERE member_id = $1",
      [cur]
    );
    if (!rows.length || !rows[0].parent_id) break;
    const { rows: anc } = await c.query(
      "SELECT id, member_id FROM users WHERE member_id = $1",
      [rows[0].parent_id]
    );
    if (!anc.length) break;
    ancestors.push({ ...anc[0], childPosition: rows[0].binary_position });
    cur = anc[0].member_id;
  }
  return ancestors;
}

async function addBv(c, ancestorId, position) {
  const { rows } = await c.query(
    "SELECT id FROM users WHERE member_id = $1",
    [ancestorId]
  );
  if (!rows.length) return;
  const uid = rows[0].id;
  const { rows: pts } = await c.query(
    "SELECT * FROM binary_points WHERE user_id = $1",
    [uid]
  );
  if (pts.length) {
    if (position === "left") {
      await c.query("UPDATE binary_points SET left_points = left_points + $1 WHERE user_id = $2", [BV, uid]);
    } else {
      await c.query("UPDATE binary_points SET right_points = right_points + $1 WHERE user_id = $2", [BV, uid]);
    }
  } else {
    await c.query(
      "INSERT INTO binary_points (user_id, left_points, right_points) VALUES ($1, $2, $3)",
      [uid, position === "left" ? BV : 0, position === "right" ? BV : 0]
    );
  }
}

async function processMatching(c, userId, memberId) {
  const { rows: pts } = await c.query("SELECT * FROM binary_points WHERE user_id = $1", [userId]);
  if (!pts.length) return { matched: 0, bonus: 0 };
  const p = pts[0];
  const matchAmount = Math.min(p.left_points, p.right_points);
  if (matchAmount <= 0) return { matched: 0, bonus: 0 };

  const bonus = Math.floor((matchAmount * MATCHING_PCT) / 100);
  if (bonus <= 0) return { matched: 0, bonus: 0 };

  await c.query("UPDATE wallets SET mlm_balance = mlm_balance + $1 WHERE user_id = $2", [bonus, userId]);
  await c.query(
    "INSERT INTO wallet_ledger (user_id, amount, type, description) VALUES ($1, $2, 'matching_bonus', $3)",
    [userId, bonus, `10% matching on ${matchAmount} BV`]
  );
  await c.query(
    "UPDATE binary_points SET left_points = left_points - $1, right_points = right_points - $1 WHERE user_id = $2",
    [matchAmount, userId]
  );
  return { matched: matchAmount, bonus };
}

async function run() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    await c.query("DELETE FROM epin_purchases");
    await c.query("DELETE FROM wallet_ledger");
    await c.query("DELETE FROM binary_points");
    await c.query("DELETE FROM history_logs");
    await c.query("DELETE FROM investments");
    await c.query("DELETE FROM deposits");
    await c.query("DELETE FROM wallets WHERE user_id != 1");
    await c.query("DELETE FROM users WHERE id != 1");
    await c.query("UPDATE wallets SET balance = 0, mlm_balance = 0, investment_balance = 0 WHERE user_id = 1");
    await c.query("UPDATE binary_points SET left_points = 0, right_points = 0 WHERE user_id = 1");
    await c.query("UPDATE users SET parent_id = NULL, binary_position = NULL, sponsor_id = NULL, leg_preference = 'right' WHERE id = 1");

    const salt = await bcrypt.genSalt(12);
    const pw = await bcrypt.hash("Test@1234", salt);

    console.log("=== Registering 15 users ===\n");

    let totalDirectPaid = 0;
    let totalMatchingPaid = 0;

    for (let i = 0; i < TEST_USERS.length; i++) {
      const [name, sponsorMid, legPref] = TEST_USERS[i];
      const newId = mid(i + 2);
      const sponsorRow = (await c.query("SELECT id FROM users WHERE member_id = $1", [sponsorMid])).rows[0];

      const slot = await findEmptySlot(c, sponsorMid, legPref, 0);
      if (!slot) { console.log(`  SKIP ${name} - no slot`); continue; }

      const { rows: inserted } = await c.query(
        `INSERT INTO users (full_name, email, mobile_number, password, member_id, kyc_status, role, sponsor_id, parent_id, binary_position, leg_preference)
         VALUES ($1, $2, $3, $4, $5, 'APPROVED', 'user', $6, $7, $8, $9) RETURNING id`,
        [name, `${name.toLowerCase()}@test.com`, `90000000${String(i + 10).padStart(2, "0")}`, pw, newId, sponsorMid, slot.parentId, slot.pos, legPref]
      );
      const uid = inserted[0].id;

      await c.query("INSERT INTO wallets (user_id, balance, mlm_balance) VALUES ($1, 0, 0)", [uid]);
      await c.query("INSERT INTO binary_points (user_id, left_points, right_points) VALUES ($1, 0, 0)", [uid]);

      await c.query("UPDATE wallets SET mlm_balance = mlm_balance + $1 WHERE user_id = $2", [DIRECT_BONUS, sponsorRow.id]);
      await c.query(
        "INSERT INTO wallet_ledger (user_id, amount, type, description) VALUES ($1, $2, 'direct_commission', $3)",
        [sponsorRow.id, DIRECT_BONUS, `Direct referral bonus for sponsoring ${newId}`]
      );
      totalDirectPaid += DIRECT_BONUS;

      const ancestors = await getAncestors(c, newId);
      let matchTotal = 0;
      for (const anc of ancestors) {
        await addBv(c, anc.memberId, anc.childPosition);
        const m = await processMatching(c, anc.id, anc.memberId);
        matchTotal += m.bonus;
      }
      totalMatchingPaid += matchTotal;

      console.log(`  ${newId} ${name.padEnd(8)} sponsored by ${sponsorMid} → ${slot.parentId}[${slot.pos}]  Direct: ₹${DIRECT_BONUS}  Matching cascade: ₹${matchTotal}`);
    }

    console.log("\n=== FINAL STATE ===\n");

    const { rows: allUsers } = await c.query(
      "SELECT u.member_id, u.full_name, u.parent_id, u.binary_position, u.sponsor_id, w.mlm_balance, bp.left_points, bp.right_points FROM users u LEFT JOIN wallets w ON w.user_id = u.id LEFT JOIN binary_points bp ON bp.user_id = u.id ORDER BY u.id"
    );

    console.log("User          Name        Parent       Side   Sponsor      MLM Balance  L-BV  R-BV");
    console.log("─".repeat(95));
    for (const u of allUsers) {
      console.log(
        `${(u.member_id || "").padEnd(14)}${(u.full_name || "").padEnd(12)}${(u.parent_id || "ROOT").padEnd(13)}${(u.binary_position || "-").padEnd(7)}${(u.sponsor_id || "-").padEnd(13)}₹${String(u.mlm_balance || 0).padStart(6)}   ${String(u.left_points || 0).padStart(4)}  ${String(u.right_points || 0).padStart(4)}`
      );
    }

    console.log("\n=== COMMISSION SUMMARY ===");
    console.log(`  Total Direct Referral Paid : ₹${totalDirectPaid} (${TEST_USERS.length} users x ₹${DIRECT_BONUS})`);
    console.log(`  Total Matching Bonus Paid  : ₹${totalMatchingPaid}`);
    console.log(`  Grand Total Distributed    : ₹${totalDirectPaid + totalMatchingPaid}`);

    const { rows: adminWallet } = await c.query("SELECT mlm_balance FROM wallets WHERE user_id = 1");
    console.log(`\n  Admin wallet (mlmBalance)  : ₹${adminWallet[0]?.mlm_balance || 0}`);

    await c.query("COMMIT");
    console.log("\nDone!");
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("FAILED:", err.message);
  } finally {
    c.release();
    await pool.end();
  }
}

run();
