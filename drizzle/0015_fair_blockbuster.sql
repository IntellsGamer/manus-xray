CREATE TABLE `terminal_leases` (
	`slot` varchar(32) NOT NULL,
	`leaseId` varchar(64) NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`instanceId` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `terminal_leases_slot` PRIMARY KEY(`slot`)
);
