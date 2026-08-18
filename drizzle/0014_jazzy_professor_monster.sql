CREATE TABLE `client_policy_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`trafficLimitBytes` bigint NOT NULL DEFAULT -1,
	`dayLimit` int NOT NULL DEFAULT -1,
	`speedLimitMbps` int NOT NULL DEFAULT -1,
	`connectionLimit` int NOT NULL DEFAULT -1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `client_policy_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_policy_templates_name_unique` UNIQUE(`name`)
);
