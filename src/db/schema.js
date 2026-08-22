import { pgTable, serial, text, varchar, timestamp, integer, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";

// ==========================================
// 1. USERS TABLE COMPONENT
// ==========================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  mobileNumber: varchar("mobile_number", { length: 20 }).unique().notNull(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  memberId: varchar("member_id", { length: 20 }).unique().notNull(),
  kycStatus: varchar("kyc_status", { length: 20 }).default("PENDING").notNull(),
  avatarUrl: text("avatar_url").default(""),
  role: varchar("role", { length: 20 }).default("user").notNull(),
  // ── Binary MLM Fields ──
  sponsorId: varchar("sponsor_id", { length: 20 }),
  parentId: varchar("parent_id", { length: 20 }),
  binaryPosition: varchar("binary_position", { length: 5 }),
  legPreference: varchar("leg_preference", { length: 5 }).default("right"),
});

// ==========================================
// 2. WALLETS COMPONENT (Tracks User Balances)
// ==========================================
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .unique()
    .notNull(),
  balance: integer("balance").default(0).notNull(),
  investmentBalance: integer("investment_balance").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==========================================
// 3. DEPOSITS COMPONENT (UTR Manual Approvals Queue)
// ==========================================
export const deposits = pgTable("deposits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  amount: integer("amount").notNull(),
  utrNumber: varchar("utr_number", { length: 50 }).unique().notNull(),
  status: varchar("status", { length: 20 }).default("PENDING").notNull(), // 'PENDING', 'APPROVED', 'DECLINED'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==========================================
// 4. INVESTMENTS COMPONENT (Tracks Allocation Per Plan Type)
// ==========================================
export const investments = pgTable("investments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  planType: varchar("plan_type", { length: 50 }).notNull(), // 'MIP', 'SIP', 'INSURANCE', 'SHARES', 'AGRI'
  amount: integer("amount").default(0).notNull(), // Maintained in integer format to prevent calculations bugs
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const historyLogs = pgTable("history_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),       // Who did it?
  feature: varchar("feature").notNull(),     // What category? (e.g., 'WALLET', 'INVESTMENT', 'KYC')
  action: varchar("action").notNull(),       // What exactly happened? (e.g., 'DEPOSIT', 'PLAN_BOUGHT')
  message: text("message").notNull(),         // A simple sentence explaining it
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ==========================================
// 5. E-PINS TABLE (Registration Access Tokens)
// ==========================================
export const epins = pgTable("epins", {
  id: serial("id").primaryKey(),
  pinCode: varchar("pin_code", { length: 12 }).unique().notNull(),
  status: varchar("status", { length: 10 }).default("active").notNull(),
  generatedByUserId: integer("generated_by_user_id"),
  usedByUserId: integer("used_by_user_id"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 6. BINARY POINTS TABLE (Per-User BV Ledger)
// ==========================================
export const binaryPoints = pgTable("binary_points", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).unique().notNull(),
  leftPoints: integer("left_points").default(0).notNull(),
  rightPoints: integer("right_points").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 7. WALLET LEDGER TABLE (Double-Entry Earnings)
// ==========================================
export const walletLedger = pgTable("wallet_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  amount: integer("amount").notNull(),
  type: varchar("type", { length: 30 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 8. E-PIN PURCHASES TABLE (Payment Tracking)
// ==========================================
export const epinPurchases = pgTable("epin_purchases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  amount: integer("amount").notNull(),
  paymentMethod: varchar("payment_method", { length: 30 }).default("online"),
  paymentRef: varchar("payment_ref", { length: 100 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});