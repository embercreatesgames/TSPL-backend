import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq, or } from "drizzle-orm";
import { db } from "../config/db.js";
import { users } from "../db/schema.js";
import { authLimiter } from "../middleware/rateLimiter.js";

// 🟢 Clean & Separated Named Imports
import { verifyToken, verifyAdmin } from "../middleware/auth.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// ==============================================================================
// 1. REGISTRATION ENDPOINT (Screen 5)
// ==============================================================================
router.post("/register", authLimiter, async (req, res) => {
  const { fullName, email, mobileNumber, password } = req.body;

  if (!fullName || !email || !mobileNumber || !password) {
    return res.status(400).json({
      error:
        "All fields (fullName, email, mobileNumber, password) are required.",
    });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters long." });
  }

  try {
    const existingUser = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.email, email.toLowerCase().trim()),
          eq(users.mobileNumber, mobileNumber.trim())
        )
      )
      .limit(1);

    if (existingUser.length > 0) {
      return res.status(409).json({
        error: "An account with this email or mobile number already exists.",
      });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const generatedMemberId = "MARUP" + String(Date.now()).slice(-6);

    await db.insert(users).values({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      mobileNumber: mobileNumber.trim(),
      password: hashedPassword,
      memberId: generatedMemberId,
      kycStatus: "PENDING",
      role: "user",
      avatarUrl: "",
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
    });
  } catch (error) {
    console.error("Registration Error:", error);
    return res.status(500).json({ error: "Internal system server failure" });
  }
});

// ==============================================================================
// 2. LOGIN ENDPOINT (Screen 6)
// ==============================================================================
router.post("/login", authLimiter, async (req, res) => {
  const { email, mobileNumber, password } = req.body;

  if (!email && !mobileNumber) {
    return res.status(400).json({
      error: "Please provide either an email or mobile number to log in.",
    });
  }
  if (!password) {
    return res.status(400).json({ error: "Password field cannot be empty." });
  }

  try {
    let userResult = [];

    if (email) {
      userResult = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);
    } else if (mobileNumber) {
      userResult = await db
        .select()
        .from(users)
        .where(eq(users.mobileNumber, mobileNumber.trim()))
        .limit(1);
    }

    const user = userResult[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials provided." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials provided." });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        mobileNumber: user.mobileNumber,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ error: "Internal system server failure" });
  }
});

// ==============================================================================
// 3. FETCH PROFILE DETAILS (Screens 15 & 31)
// ==============================================================================
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const userResult = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        mobileNumber: users.mobileNumber,
        memberId: users.memberId,
        kycStatus: users.kycStatus,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, req.user.userId))
      .limit(1);

    const user = userResult[0];
    if (!user) {
      return res.status(404).json({ error: "Profile data record not found." });
    }

    return res.status(200).json({
      success: true,
      profile: user,
    });
  } catch (error) {
    console.error("Fetch Profile Error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ==============================================================================
// 4. UPDATE PROFILE DETAILS (Screen 31)
// ==============================================================================
router.put("/profile/update", verifyToken, async (req, res) => {
  const { fullName, email } = req.body;

  if (!fullName || !email) {
    return res
      .status(400)
      .json({ error: "Full name and email cannot be left empty." });
  }

  try {
    await db
      .update(users)
      .set({
        fullName: fullName.trim(),
        email: email.toLowerCase().trim(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.user.userId));

    return res.status(200).json({
      success: true,
      message: "Profile information updated successfully!",
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;

// ==============================================================================
// 5. ADMIN SETUP (one-time use)
// ==============================================================================
router.post("/admin/setup", authLimiter, async (req, res) => {
  const { fullName, email, mobileNumber, password } = req.body;

  if (!fullName || !email || !mobileNumber || !password) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const generatedMemberId = "MARUP" + String(Date.now()).slice(-6);

    await db.insert(users).values({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      mobileNumber: mobileNumber.trim(),
      password: hashedPassword,
      memberId: generatedMemberId,
      kycStatus: "VERIFIED",
      role: "admin",
      avatarUrl: "",
    });

    return res.status(201).json({
      success: true,
      message: "Admin account created successfully!",
    });
  } catch (error) {
    console.error("Admin Setup Error:", error);
    return res.status(500).json({ error: "Internal system server failure" });
  }
});
