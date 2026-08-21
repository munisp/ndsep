CREATE TABLE `wafThreatFilterPresets` (
	`presetId` varchar(80) NOT NULL,
	`agencyId` varchar(120) NOT NULL,
	`name` varchar(80) NOT NULL,
	`query` varchar(160) NOT NULL,
	`createdBy` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wafThreatFilterPresets_presetId` PRIMARY KEY(`presetId`)
);
