ALTER TABLE `gateway_clients` ADD `connectionToken` varchar(64);--> statement-breakpoint
UPDATE `gateway_clients` SET `connectionToken` = REPLACE(UUID(), '-', '') WHERE `connectionToken` IS NULL;--> statement-breakpoint
ALTER TABLE `gateway_clients` MODIFY `connectionToken` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `gateway_clients` ADD CONSTRAINT `gateway_clients_connectionToken_unique` UNIQUE(`connectionToken`);
