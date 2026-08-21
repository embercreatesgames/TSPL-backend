import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

async function reset() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tables = [
      "epin_purchases",
      "wallet_ledger",
      "binary_points",
      "epins",
      "history_logs",
      "investments",
      "deposits",
      "wallets",
      "users",
    ];

    for (const table of tables) {
      await client.query(`TRUNCATE "${table}" RESTART IDENTITY CASCADE`);
      console.log(`  ✓ ${table}`);
    }

    await client.query("COMMIT");
    console.log("\nAll tables wiped. Database is clean.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reset failed:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

reset();
