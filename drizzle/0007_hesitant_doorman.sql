ALTER TABLE `gateway_clients` ADD `quotaExhaustedAt` timestamp;--> statement-breakpoint
ALTER TABLE `vless_profiles` ADD `quotaScheduleTaskUid` varchar(65);