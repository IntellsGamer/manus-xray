CREATE TABLE `owner_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`deviceToken` varchar(64) NOT NULL,
	`deviceName` varchar(160) NOT NULL,
	`deviceKind` varchar(24) NOT NULL,
	`browser` varchar(64) NOT NULL,
	`operatingSystem` varchar(64) NOT NULL,
	`userAgent` varchar(512) NOT NULL,
	`ipAddress` varchar(64),
	`countryCode` varchar(8),
	`city` varchar(128),
	`region` varchar(128),
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	CONSTRAINT `owner_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_devices_owner_token_unique` UNIQUE(`ownerOpenId`,`deviceToken`)
);
--> statement-breakpoint
CREATE INDEX `owner_devices_owner_last_seen_idx` ON `owner_devices` (`ownerOpenId`,`lastSeenAt`);