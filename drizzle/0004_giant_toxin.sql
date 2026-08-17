ALTER TABLE `gateway_clients` ADD `trafficLimitBytes` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `gateway_clients` ADD `dayLimit` int DEFAULT 0 NOT NULL;