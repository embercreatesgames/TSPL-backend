import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq, and, or } from "drizzle-orm";
import { db } from "../config/db.js";
import { users, epins } from "../db/schema.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { placeNewUserAndProcessCommissions } from "../services/mlm.service.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// ==============================================================================
// 1. REGISTRATION ENDPOINT (MLM-Gated)
// ==============================================================================
router.post("/register", authLimiter, async (req, res) => {
  const { fullName, email, mobileNumber, password, referralId, pinCode } = req.body;

  if (!fullName || !email || !mobileNumber || !password || !referralId || !pinCode) {
    return res.status(400).json({
      error: "All fields are required: fullName, email, mobileNumber, password, referralId, pinCode.",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long." });
  }

  try {
    const [sponsor] = await db
      .select()
      .from(users)
      .where(eq(users.memberId, referralId.toUpperCase().trim()))
      .limit(1);
    if (!sponsor) {
      return res.status(404).json({ error: "Invalid Referral ID. Sponsor not found." });
    }

    const [pin] = await db
      .select()
      .from(epins)
      .where(eq(epins.pinCode, pinCode.toUpperCase().trim()))
      .limit(1);
    if (!pin) {
      return res.status(404).json({ error: "Invalid E-PIN. Not found." });
    }
    if (pin.status !== "active") {
      return res.status(400).json({ error: "E-PIN has already been used." });
    }

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
      return res.status(409).json({ error: "An account with this email or mobile number already exists." });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);
    const generatedMemberId = "MARUP" + String(Date.now()).slice(-6);

    let newUser;
    await db.transaction(async (tx) => {
      await tx.update(epins).set({ status: "used", usedAt: new Date() }).where(eq(epins.id, pin.id));

      const [insertedUser] = await tx.insert(users).values({
        fullName: fullName.trim(),
        email: email.toLowerCase().trim(),
        mobileNumber: mobileNumber.trim(),
        password: hashedPassword,
        memberId: generatedMemberId,
        kycStatus: "PENDING",
        role: "user",
        avatarUrl: "",
        sponsorId: sponsor.memberId,
      }).returning();
      newUser = insertedUser;

      await placeNewUserAndProcessCommissions(tx, newUser.id, generatedMemberId, sponsor.memberId);
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
      memberId: generatedMemberId,
    });
  } catch (error) {
    console.error("Registration Error:", error);
    const detail = process.env.NODE_ENV === "production" ? error.message : error.stack;
    return res.status(500).json({ error: "Internal system server failure", detail });
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
        legPreference: user.legPreference || "right",
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ error: "Internal system server failure" });
  }
});

// ==============================================================================
// 3. FETCH PROFILE DETAILS
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
        sponsorId: users.sponsorId,
        parentId: users.parentId,
        binaryPosition: users.binaryPosition,
        legPreference: users.legPreference,
        createdAt: users.createdAt,
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

// ==============================================================================
// 6. ADMIN - GET ALL USERS
// ==============================================================================
router.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        mobileNumber: users.mobileNumber,
        memberId: users.memberId,
        role: users.role,
        kycStatus: users.kycStatus,
        createdAt: users.createdAt,
      })
      .from(users);

    return res.status(200).json({
      success: true,
      users: allUsers,
    });
  } catch (error) {
    console.error("Admin Users Error:", error);
    return res.status(500).json({ error: "Failed to fetch users." });
  }
});

// ==============================================================================
// 7. TOGGLE LEG PREFERENCE
// ==============================================================================
router.put("/leg-preference", verifyToken, async (req, res) => {
  const { legPreference } = req.body;
  if (!["left", "right"].includes(legPreference)) {
    return res.status(400).json({ error: "legPreference must be 'left' or 'right'." });
  }
  try {
    await db.update(users).set({ legPreference, updatedAt: new Date() }).where(eq(users.id, req.user.userId));
    return res.status(200).json({ success: true, legPreference });
  } catch (error) {
    console.error("Leg Preference Error:", error);
    return res.status(500).json({ error: "Failed to update leg preference." });
  }
});
