ALTER TABLE `gateway_clients` ADD `trafficUsedBytes` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gateway_clients` ADD `trafficStatsSnapshotBytes` bigint DEFAULT 0 NOT NULL;