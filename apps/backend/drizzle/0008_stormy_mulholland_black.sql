CREATE TABLE `org_members` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`member_email` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_members_unique` ON `org_members` (`owner_email`,`member_email`);--> statement-breakpoint
CREATE INDEX `org_members_member_idx` ON `org_members` (`member_email`);--> statement-breakpoint
ALTER TABLE `magic_links` ADD `redirect` text DEFAULT '' NOT NULL;