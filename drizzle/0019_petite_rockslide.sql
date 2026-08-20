CREATE TABLE `gateway_reconnect_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`protocol` varchar(24) NOT NULL,
	`sourceGroup` varchar(96) NOT NULL,
	`blockedUntil` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gateway_reconnect_blocks_id` PRIMARY KEY(`id`),
	CONSTRAINT `gateway_reconnect_blocks_scope_unique` UNIQUE(`clientId`,`protocol`,`sourceGroup`)
);
--> statement-breakpoint
CREATE INDEX `gateway_reconnect_blocks_active_idx` ON `gateway_reconnect_blocks` (`clientId`,`protocol`,`sourceGroup`,`blockedUntil`);