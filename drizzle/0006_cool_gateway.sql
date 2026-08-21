CREATE TABLE `wafThreatFilterPresetRevisions` (
	`revisionId` varchar(80) NOT NULL,
	`presetId` varchar(80) NOT NULL,
	`version` int NOT NULL,
	`query` varchar(160) NOT NULL,
	`submittedBy` varchar(255) NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewedBy` varchar(255),
	`reviewedAt` timestamp,
	`reviewNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wafThreatFilterPresetRevisions_revisionId` PRIMARY KEY(`revisionId`)
);
--> statement-breakpoint
ALTER TABLE `wafThreatFilterPresets` ADD `approvalStatus` enum('pending','approved','rejected') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `wafThreatFilterPresets` ADD `activeVersion` int DEFAULT 0 NOT NULL;