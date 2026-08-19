ALTER TABLE `gateway_clients` ADD `shadowsocksUserKey` varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `shadowsocksServerKey` varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `shadowsocksUserKey` varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `shadowsocksWsPath` varchar(255) DEFAULT '/shadowsocks' NOT NULL;
