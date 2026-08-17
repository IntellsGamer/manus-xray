ALTER TABLE `gateway_clients` ADD `creationRequestId` varchar(64);--> statement-breakpoint
ALTER TABLE `gateway_clients` ADD `activationDueAt` timestamp;--> statement-breakpoint
ALTER TABLE `gateway_clients` ADD CONSTRAINT `gateway_clients_creationRequestId_unique` UNIQUE(`creationRequestId`);