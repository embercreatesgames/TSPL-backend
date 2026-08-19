import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { execSync } from "child_process"; // ⚡ Added for automatic execution
import "dotenv/config";

const { Pool } = pg;

// Connection pooling manages multiple visual actions smoothly
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true, // Ensures encrypted transit to Neon in production
  },
  max: 20, // Max clients in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Neon client", err);
});

// 🔄 AUTOMATIC TABLE SYNC
// Replicates "npx drizzle-kit push" on startup so you never get missing table errors.
try {
  console.log("⏳ Checking and syncing database tables with Neon...");
  execSync("npx drizzle-kit push", { stdio: "inherit" });
  console.log("✅ Database schema is perfectly synchronized!");
} catch (syncError) {
  console.error(
    "⚠️ Auto-push skipped or failed. Check connection or syntax:",
    syncError.message
  );
}

export const db = drizzle(pool);
