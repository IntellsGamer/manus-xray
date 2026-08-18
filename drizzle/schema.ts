import { bigint, boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  globalProfileEnabled: boolean("globalProfileEnabled").notNull().default(true),
  quotaScheduleTaskUid: varchar("quotaScheduleTaskUid", { length: 65 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VlessProfile = typeof vlessProfiles.$inferSelect;
export type InsertVlessProfile = typeof vlessProfiles.$inferInsert;

/** Named identities that share the gateway transport but own distinct credentials and feeds. */
export const gatewayClients = mysqlTable("gateway_clients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  vlessUuid: varchar("vlessUuid", { length: 36 }).notNull().unique(),
  vmessUuid: varchar("vmessUuid", { length: 36 }).notNull().unique(),
  trojanPassword: varchar("trojanPassword", { length: 64 }).notNull().unique(),
  socksUsername: varchar("socksUsername", { length: 64 }).notNull().unique(),
  socksPassword: varchar("socksPassword", { length: 64 }).notNull(),
  subscriptionToken: varchar("subscriptionToken", { length: 96 }).notNull().unique(),
  connectionToken: varchar("connectionToken", { length: 64 }).notNull().unique(),
  creationRequestId: varchar("creationRequestId", { length: 64 }).unique(),
  activationDueAt: timestamp("activationDueAt"),
  activationFailedAt: timestamp("activationFailedAt"),
  trafficLimitBytes: bigint("trafficLimitBytes", { mode: "number" }).notNull().default(-1),
  trafficUsedBytes: bigint("trafficUsedBytes", { mode: "number" }).notNull().default(0),
  trafficStatsSnapshotBytes: bigint("trafficStatsSnapshotBytes", { mode: "number" }).notNull().default(0),
  quotaExhaustedAt: timestamp("quotaExhaustedAt"),
  dayLimit: int("dayLimit").notNull().default(-1),
  speedLimitMbps: int("speedLimitMbps").notNull().default(-1),
  connectionLimit: int("connectionLimit").notNull().default(-1),
  expiresAt: timestamp("expiresAt"),
  lastSubscriptionAt: timestamp("lastSubscriptionAt"),
  subscriptionDeliveryCount: int("subscriptionDeliveryCount").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type GatewayClient = typeof gatewayClients.$inferSelect;
export type InsertGatewayClient = typeof gatewayClients.$inferInsert;

/** Real delivery observations for subscription routes; this is not proxy traffic accounting. */
export const subscriptionEvents = mysqlTable("subscription_events", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId"),
  profileKind: mysqlEnum("profileKind", ["global", "client"]).notNull(),
  deliveryKind: mysqlEnum("deliveryKind", ["browser", "proxy"]).notNull(),
  userAgent: varchar("userAgent", { length: 512 }),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
});

export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
