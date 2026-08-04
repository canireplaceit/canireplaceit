ALTER TABLE `sponsor_purchases` ADD `order_id` text;--> statement-breakpoint
CREATE INDEX `sponsor_purchases_order_idx` ON `sponsor_purchases` (`order_id`);