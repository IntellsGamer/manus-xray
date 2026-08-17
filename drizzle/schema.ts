import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * A single owner-managed VLESS profile. The fixed primary key keeps the panel
 * intentionally scoped to one gateway rather than becoming multi-tenant.
 */
export const vlessProfiles = mysqlTable("vless_profiles", {
  id: int("id").primaryKey(),
  uuid: varchar("uuid", { length: 36 }).notNull().unique(),
  serverAddress: varchar("serverAddress", { length: 255 }).notNull(),
  port: int("port").notNull(),
  wsPath: varchar("wsPath", { length: 255 }).notNull(),
  tlsEnabled: boolean("tlsEnabled").notNull().default(true),
  subscriptionToken: varchar("subscriptionToken", { length: 96 }).notNull().unique(),
  vmessUuid: varchar("vmessUuid", { length: 36 }).notNull().default(""),
  vmessWsPath: varchar("vmessWsPath", { length: 255 }).notNull().default("/vmess"),
  trojanPassword: varchar("trojanPassword", { length: 64 }).notNull().default(""),
  trojanWsPath: varchar("trojanWsPath", { length: 255 }).notNull().default("/trojan"),
  socksUsername: varchar("socksUsername", { length: 64 }).notNull().default(""),
  socksPassword: varchar("socksPassword", { length: 64 }).notNull().default(""),
  socksWsPath: varchar("socksWsPath", { length: 255 }).notNull().default("/socks"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VlessProfile = typeof vlessProfiles.$inferSelect;
export type InsertVlessProfile = typeof vlessProfiles.$inferInsert;
