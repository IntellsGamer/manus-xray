CREATE TABLE `vless_profiles` (
	`id` int NOT NULL,
	`uuid` varchar(36) NOT NULL,
	`serverAddress` varchar(255) NOT NULL,
	`port` int NOT NULL,
	`wsPath` varchar(255) NOT NULL,
	`tlsEnabled` boolean NOT NULL DEFAULT true,
	`subscriptionToken` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vless_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `vless_profiles_uuid_unique` UNIQUE(`uuid`),
	CONSTRAINT `vless_profiles_subscriptionToken_unique` UNIQUE(`subscriptionToken`)
);
