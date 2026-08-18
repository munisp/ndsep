CREATE TABLE `diagnosticAttestationReceipts` (
	`receiptId` varchar(80) NOT NULL,
	`packageType` enum('passphrase_encrypted','administrative_public_key') NOT NULL,
	`packageSha256` varchar(64) NOT NULL,
	`attestedForSubject` varchar(255) NOT NULL,
	`signerKeyId` varchar(120) NOT NULL,
	`signerFingerprint` varchar(64) NOT NULL,
	`receiptJson` text NOT NULL,
	`revokedAt` timestamp,
	`revokedBy` varchar(255),
	`revocationReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `diagnosticAttestationReceipts_receiptId` PRIMARY KEY(`receiptId`)
);
