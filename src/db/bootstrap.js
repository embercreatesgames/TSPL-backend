import pg from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

async function bootstrap() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if any users exist
    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (Number(rows[0].count) > 0) {
      console.log("Users already exist. Aborting.");
      await client.query("ROLLBACK");
      return;
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash("Admin@123", salt);
    const memberId = "MARUP000001";

    // Insert admin user
    const { rows: [user] } = await client.query(
      `INSERT INTO users (full_name, email, mobile_number, password, member_id, kyc_status, role, leg_preference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      ["Admin", "admin@marup.com", "9999999999", hashedPassword, memberId, "APPROVED", "admin", "right"]
    );

    // Create wallet
    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [user.id]);

    // Create binary points
    await client.query('INSERT INTO binary_points (user_id, left_points, right_points) VALUES ($1, 0, 0)', [user.id]);

    // Generate 10 E-PINs
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < 10; i++) {
      let code = "";
      for (let j = 0; j < 12; j++) code += chars[Math.floor(Math.random() * chars.length)];
      await client.query(
        'INSERT INTO epins (pin_code, status, generated_by_user_id) VALUES ($1, $2, $3)',
        [code, "active", user.id]
      );
      console.log(`  PIN ${i + 1}: ${code}`);
    }

    await client.query("COMMIT");
    console.log(`\nAdmin created!`);
    console.log(`  Member ID : ${memberId}`);
    console.log(`  Email     : admin@marup.com`);
    console.log(`  Password  : Admin@123`);
    console.log(`  Role      : admin`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Bootstrap failed:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

bootstrap();
