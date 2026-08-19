CREATE TABLE `diagnosticReceiptRevocationNotifications` (
	`notificationId` varchar(80) NOT NULL,
	`receiptId` varchar(80) NOT NULL,
	`recipientSubject` varchar(255) NOT NULL,
	`revocationReason` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`readAt` timestamp,
	CONSTRAINT `diagnosticReceiptRevocationNotifications_notificationId` PRIMARY KEY(`notificationId`)
);
