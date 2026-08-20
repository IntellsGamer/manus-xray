import { bigint, boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  shadowsocksServerKey: varchar("shadowsocksServerKey", { length: 128 }).notNull().default(""),
  shadowsocksUserKey: varchar("shadowsocksUserKey", { length: 128 }).notNull().default(""),
  shadowsocksWsPath: varchar("shadowsocksWsPath", { length: 255 }).notNull().default("/shadowsocks"),
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
  shadowsocksUserKey: varchar("shadowsocksUserKey", { length: 128 }).notNull().default(""),
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
  allowedProtocols: varchar("allowedProtocols", { length: 128 }).notNull().default("vless,xhttp,vmess,trojan,socks,shadowsocks"),
  expiresAt: timestamp("expiresAt"),
  lastSubscriptionAt: timestamp("lastSubscriptionAt"),
  subscriptionDeliveryCount: int("subscriptionDeliveryCount").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type GatewayClient = typeof gatewayClients.$inferSelect;
export type InsertGatewayClient = typeof gatewayClients.$inferInsert;

/** Durable owner-visible state for a named gateway tunnel, including cross-instance disconnect requests. */
export const gatewayLiveSessions = mysqlTable("gateway_live_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  clientId: int("clientId").notNull(),
  protocol: varchar("protocol", { length: 24 }).notNull(),
  sourceGroup: varchar("sourceGroup", { length: 96 }).notNull(),
  uplinkBytes: bigint("uplinkBytes", { mode: "number" }).notNull().default(0),
  downlinkBytes: bigint("downlinkBytes", { mode: "number" }).notNull().default(0),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  disconnectRequestedAt: timestamp("disconnectRequestedAt"),
  closedAt: timestamp("closedAt"),
  closeReason: varchar("closeReason", { length: 32 }),
}, table => [
  index("gateway_live_sessions_client_active_idx").on(table.clientId, table.closedAt, table.lastSeenAt),
  index("gateway_live_sessions_disconnect_idx").on(table.disconnectRequestedAt, table.closedAt),
]);

export type GatewayLiveSession = typeof gatewayLiveSessions.$inferSelect;

/** Reusable client-policy presets. They never contain client credentials or usage. */
export const clientPolicyTemplates = mysqlTable("client_policy_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  trafficLimitBytes: bigint("trafficLimitBytes", { mode: "number" }).notNull().default(-1),
  dayLimit: int("dayLimit").notNull().default(-1),
  speedLimitMbps: int("speedLimitMbps").notNull().default(-1),
  connectionLimit: int("connectionLimit").notNull().default(-1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("client_policy_templates_name_unique").on(table.name),
]);

export type ClientPolicyTemplate = typeof clientPolicyTemplates.$inferSelect;

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

/** Owner-authorized browser sessions observed by the admin gateway. */
export const ownerDevices = mysqlTable("owner_devices", {
  id: int("id").autoincrement().primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  deviceToken: varchar("deviceToken", { length: 64 }).notNull(),
  deviceName: varchar("deviceName", { length: 160 }).notNull(),
  deviceKind: varchar("deviceKind", { length: 24 }).notNull(),
  browser: varchar("browser", { length: 64 }).notNull(),
  operatingSystem: varchar("operatingSystem", { length: 64 }).notNull(),
  userAgent: varchar("userAgent", { length: 512 }).notNull(),
  ipAddress: varchar("ipAddress", { length: 64 }),
  countryCode: varchar("countryCode", { length: 8 }),
  city: varchar("city", { length: 128 }),
  region: varchar("region", { length: 128 }),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  revokedAt: timestamp("revokedAt"),
}, table => [
  uniqueIndex("owner_devices_owner_token_unique").on(table.ownerOpenId, table.deviceToken),
  index("owner_devices_owner_last_seen_idx").on(table.ownerOpenId, table.lastSeenAt),
]);

export type OwnerDevice = typeof ownerDevices.$inferSelect;

/** A short-lived, database-backed owner terminal lease shared by all application instances. */
export const terminalLeases = mysqlTable("terminal_leases", {
  slot: varchar("slot", { length: 32 }).primaryKey(),
  leaseId: varchar("leaseId", { length: 64 }).notNull(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  instanceId: varchar("instanceId", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

export type TerminalLease = typeof terminalLeases.$inferSelect;
