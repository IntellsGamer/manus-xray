CREATE TABLE `gateway_live_sessions` (
	`id` varchar(64) NOT NULL,
	`clientId` int NOT NULL,
	`protocol` varchar(24) NOT NULL,
	`sourceGroup` varchar(96) NOT NULL,
	`uplinkBytes` bigint NOT NULL DEFAULT 0,
	`downlinkBytes` bigint NOT NULL DEFAULT 0,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`disconnectRequestedAt` timestamp,
	`closedAt` timestamp,
	`closeReason` varchar(32),
	CONSTRAINT `gateway_live_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `gateway_clients` ADD `allowedProtocols` varchar(128) DEFAULT 'vless,xhttp,vmess,trojan,socks,shadowsocks' NOT NULL;--> statement-breakpoint
CREATE INDEX `gateway_live_sessions_client_active_idx` ON `gateway_live_sessions` (`clientId`,`closedAt`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `gateway_live_sessions_disconnect_idx` ON `gateway_live_sessions` (`disconnectRequestedAt`,`closedAt`);