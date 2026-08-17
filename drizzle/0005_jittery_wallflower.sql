ALTER TABLE `gateway_clients` MODIFY COLUMN `trafficLimitBytes` bigint NOT NULL DEFAULT -1;--> statement-breakpoint
ALTER TABLE `gateway_clients` MODIFY COLUMN `dayLimit` int NOT NULL DEFAULT -1;