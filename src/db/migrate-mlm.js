import { db } from "./src/config/db.js";
import { users, binaryPoints, wallets, walletLedger } from "./src/db/schema.js";
import { eq, isNull } from "drizzle-orm";

/**
 * Migration script: Backfill existing users with MLM fields.
 *
 * - Sets sponsorId/parentId/binaryPosition to NULL (root nodes, no sponsor)
 * - Creates binaryPoints records (0 left, 0 right) for every user
 * - Ensures every user has a wallet record
 *
 * Run with: node src/db/migrate-mlm.js
 */
async function migrate() {
  console.log("Starting MLM migration for existing users...\n");

  // 1. Backfill binaryPoints for every user
  const allUsers = await db.select().from(users);
  console.log(`Found ${allUsers.length} existing users.`);

  let pointsCreated = 0;
  let walletsCreated = 0;

  for (const user of allUsers) {
    // Create binaryPoints if missing
    const [existingPoints] = await db
      .select()
      .from(binaryPoints)
      .where(eq(binaryPoints.userId, user.id))
      .limit(1);

    if (!existingPoints) {
      await db.insert(binaryPoints).values({
        userId: user.id,
        leftPoints: 0,
        rightPoints: 0,
      });
      pointsCreated++;
    }

    // Ensure wallet exists
    const [existingWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .limit(1);

    if (!existingWallet) {
      await db.insert(wallets).values({
        userId: user.id,
        balance: 0,
        investmentBalance: 0,
      });
      walletsCreated++;
    }
  }

  console.log(`Created ${pointsCreated} binaryPoints records.`);
  console.log(`Created ${walletsCreated} wallet records.`);

  // 2. Summary
  const [allPts, allW] = await Promise.all([
    db.select().from(binaryPoints),
    db.select().from(wallets),
  ]);

  console.log("\nMigration complete:");
  console.log(`  Users:         ${allUsers.length}`);
  console.log(`  Binary Points: ${allPts.length}`);
  console.log(`  Wallets:       ${allW.length}`);
  console.log("\nExisting users are now ROOT nodes (no sponsor, no parent).");
  console.log("They can generate E-PINs and start building their tree.");
}

migrate()
  .then(() => {
    console.log("\nDone.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
