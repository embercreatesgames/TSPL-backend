import { pgTable, serial, text, varchar, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

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
});

// ==========================================
// 2. WALLETS COMPONENT (Tracks User Balances)
// ==========================================
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  // Links directly to the user id property from the table above
  userId: integer("user_id")
    .references(() => users.id)
    .unique()
    .notNull(),
  balance: integer("balance").default(0).notNull(), // Track in lowest unit (cents/paise) to prevent decimal calculation glitches
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
  
  // ⚡ The Secret Sauce: This is a flexible box where you can put ANY information.
  // For investments, you can put the plan type. For wallets, you can put the UTR number.
  metadata: jsonb("metadata").default({}), 
  
  createdAt: timestamp("created_at").defaultNow().notNull(), // When?
});