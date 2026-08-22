import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";

const neonSql = neon(process.env.DATABASE_URL);
const db = drizzle(neonSql);

async function migrate() {
  console.log("Migration: merging mlm_balance into balance...\n");

  // 1. Add mlm_balance back temporarily if not exists
  try {
    await db.execute(sql`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS mlm_balance INTEGER DEFAULT 0`);
    console.log("  Ensured mlm_balance column exists.");
  } catch (e) {
    console.log("  mlm_balance column already exists.");
  }

  // 2. Merge mlm_balance into balance
  const result = await db.execute(sql`
    UPDATE wallets SET balance = balance + mlm_balance WHERE mlm_balance > 0
  `);
  console.log(`  Merged mlm_balance into balance for ${result.rowCount || 0} wallets.`);

  // 3. Drop mlm_balance column
  try {
    await db.execute(sql`ALTER TABLE wallets DROP COLUMN IF EXISTS mlm_balance`);
    console.log("  Dropped mlm_balance column.");
  } catch (e) {
    console.log("  Could not drop mlm_balance:", e.message);
  }

  // 4. Verify
  const { rows } = await db.execute(sql`SELECT user_id, balance FROM wallets`);
  console.log("\n  Final wallet balances:");
  for (const r of rows) {
    console.log(`    User ${r.user_id}: ₹${r.balance}`);
  }

  console.log("\nMigration complete.");
}

migrate().catch(console.error);
