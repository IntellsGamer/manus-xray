ALTER TABLE `vless_profiles` ADD `vmessUuid` varchar(36) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `vmessWsPath` varchar(255) DEFAULT '/vmess' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `trojanPassword` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `trojanWsPath` varchar(255) DEFAULT '/trojan' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `socksUsername` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `socksPassword` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `socksWsPath` varchar(255) DEFAULT '/socks' NOT NULL;