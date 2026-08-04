ALTER TABLE `sponsor_purchases` ADD `details_token_hash` text;--> statement-breakpoint
ALTER TABLE `sponsor_purchases` ADD `details_token_expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_purchases_details_token_hash_unique` ON `sponsor_purchases` (`details_token_hash`);