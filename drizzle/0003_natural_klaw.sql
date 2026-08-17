CREATE TABLE `gateway_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`vlessUuid` varchar(36) NOT NULL,
	`vmessUuid` varchar(36) NOT NULL,
	`trojanPassword` varchar(64) NOT NULL,
	`socksUsername` varchar(64) NOT NULL,
	`socksPassword` varchar(64) NOT NULL,
	`subscriptionToken` varchar(96) NOT NULL,
	`expiresAt` timestamp,
	`lastSubscriptionAt` timestamp,
	`subscriptionDeliveryCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gateway_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `gateway_clients_vlessUuid_unique` UNIQUE(`vlessUuid`),
	CONSTRAINT `gateway_clients_vmessUuid_unique` UNIQUE(`vmessUuid`),
	CONSTRAINT `gateway_clients_trojanPassword_unique` UNIQUE(`trojanPassword`),
	CONSTRAINT `gateway_clients_socksUsername_unique` UNIQUE(`socksUsername`),
	CONSTRAINT `gateway_clients_subscriptionToken_unique` UNIQUE(`subscriptionToken`)
);
--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int,
	`profileKind` enum('global','client') NOT NULL,
	`deliveryKind` enum('browser','proxy') NOT NULL,
	`userAgent` varchar(512),
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscription_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `globalProfileEnabled` boolean DEFAULT true NOT NULL;