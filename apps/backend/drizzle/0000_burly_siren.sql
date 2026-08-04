CREATE TABLE `quote_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`company` text,
	`seats` integer,
	`product_slugs` text NOT NULL,
	`current_spend_cents` integer DEFAULT 0 NOT NULL,
	`message` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sponsor_clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`day` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `sponsor_purchases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_clicks_unique` ON `sponsor_clicks` (`purchase_id`,`day`);--> statement-breakpoint
CREATE TABLE `sponsor_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`status` text DEFAULT 'hold' NOT NULL,
	`tier` text DEFAULT 'commercial' NOT NULL,
	`amount_cents` integer NOT NULL,
	`months` integer DEFAULT 1 NOT NULL,
	`email` text NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent` text,
	`details_token` text,
	`name` text,
	`tagline` text,
	`url` text,
	`logo_url` text,
	`repo` text,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`submitted_at` integer,
	`approved_at` integer,
	`starts_at` integer,
	`ends_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_purchases_stripe_session_id_unique` ON `sponsor_purchases` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_purchases_details_token_unique` ON `sponsor_purchases` (`details_token`);--> statement-breakpoint
CREATE INDEX `sponsor_purchases_slot_idx` ON `sponsor_purchases` (`slot_id`,`status`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_slug` text NOT NULL,
	`project_slug` text,
	`voter_id` text NOT NULL,
	`net_hash` text NOT NULL,
	`client_hash` text NOT NULL,
	`trust` real DEFAULT 1 NOT NULL,
	`reasons` text NOT NULL,
	`nullified_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_unique_voter` ON `votes` (`product_slug`,`voter_id`);--> statement-breakpoint
CREATE INDEX `votes_product_idx` ON `votes` (`product_slug`);--> statement-breakpoint
CREATE INDEX `votes_project_idx` ON `votes` (`project_slug`);--> statement-breakpoint
CREATE INDEX `votes_net_day_idx` ON `votes` (`net_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `votes_client_day_idx` ON `votes` (`client_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `waitlist` (
	`email` text PRIMARY KEY NOT NULL,
	`slot_id` text,
	`created_at` integer NOT NULL
);
