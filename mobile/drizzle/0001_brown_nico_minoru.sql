CREATE TABLE `middlewareComponents` (
	`key` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`purpose` text NOT NULL,
	`status` enum('planned','connected','degraded') NOT NULL,
	`ownerService` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `middlewareComponents_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `permitCases` (
	`id` varchar(80) NOT NULL,
	`sector` enum('mining','oil_gas','multi_agency') NOT NULL,
	`permitType` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`applicantName` varchar(255) NOT NULL,
	`locationLabel` varchar(255) NOT NULL,
	`assetReference` varchar(120) NOT NULL,
	`stage` enum('intake','spatial_clearance','technical_review','environmental_review','agency_coordination','payment_pending','approval','issued','active_monitoring') NOT NULL,
	`priority` enum('routine','elevated','critical') NOT NULL,
	`leadAgencyId` varchar(80) NOT NULL,
	`participatingAgencyIds` json NOT NULL,
	`summary` text NOT NULL,
	`timeline` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `permitCases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permitObligations` (
	`id` varchar(80) NOT NULL,
	`permitCaseId` varchar(80) NOT NULL,
	`title` varchar(255) NOT NULL,
	`dueAt` timestamp NOT NULL,
	`status` enum('pending','satisfied','at_risk') NOT NULL,
	`owner` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `permitObligations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permittingAgencies` (
	`id` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`role` text NOT NULL,
	`jurisdiction` varchar(120) NOT NULL,
	`reviewSlaHours` int NOT NULL,
	`queueDepth` int NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `permittingAgencies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `serviceTopology` (
	`id` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`language` enum('typescript','python','go','rust') NOT NULL,
	`responsibility` text NOT NULL,
	`runtimeMode` enum('webdev_backend','external_service','reserved_worker') NOT NULL,
	`endpointPath` varchar(255) NOT NULL,
	`health` enum('healthy','warning') NOT NULL,
	`middlewareKeys` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `serviceTopology_id` PRIMARY KEY(`id`)
);
