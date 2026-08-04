CREATE TABLE `ad_traffic_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`net_hash` text NOT NULL,
	`client_hash` text NOT NULL,
	`reason` text NOT NULL,
	`events` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_traffic_audit_unique` ON `ad_traffic_audit` (`day`,`net_hash`,`client_hash`,`reason`);--> statement-breakpoint
CREATE INDEX `ad_traffic_audit_day_idx` ON `ad_traffic_audit` (`day`);--> statement-breakpoint
CREATE TABLE `sponsor_impressions` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`purchase_id` text DEFAULT '' NOT NULL,
	`page` text NOT NULL,
	`page_slug` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`day` text NOT NULL,
	`trusted` integer DEFAULT true NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_impressions_unique` ON `sponsor_impressions` (`slot_id`,`purchase_id`,`page`,`page_slug`,`day`,`trusted`);--> statement-breakpoint
CREATE INDEX `sponsor_impressions_day_idx` ON `sponsor_impressions` (`day`);--> statement-breakpoint
CREATE INDEX `sponsor_impressions_purchase_idx` ON `sponsor_impressions` (`purchase_id`);--> statement-breakpoint
DROP INDEX `sponsor_clicks_unique`;--> statement-breakpoint
ALTER TABLE `sponsor_clicks` ADD `slot_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sponsor_clicks` ADD `page` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `sponsor_clicks` ADD `page_slug` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sponsor_clicks` ADD `trusted` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `sponsor_clicks_slot_idx` ON `sponsor_clicks` (`slot_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_clicks_unique` ON `sponsor_clicks` (`purchase_id`,`day`,`page`,`page_slug`,`trusted`);--> statement-breakpoint
ALTER TABLE `sponsor_purchases` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `sponsor_purchases` ADD `provider_ref` text;--> statement-breakpoint
ALTER TABLE `sponsor_purchases` ADD `released_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_purchases_provider_ref_unique` ON `sponsor_purchases` (`provider_ref`);