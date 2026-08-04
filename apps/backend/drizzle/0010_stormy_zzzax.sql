DROP INDEX `sponsor_purchases_details_token_unique`;--> statement-breakpoint
ALTER TABLE `sponsor_purchases` DROP COLUMN `details_token`;--> statement-breakpoint
-- Written by hand, below the generated statements: addresses stored before the
-- email columns canonicalised themselves are still mixed case, and SQLite `=` is
-- case-sensitive — so a purchase made as `John@` is invisible to the session
-- `john@` signs in with. `OR IGNORE` where lowercasing could collide with a row
-- that already holds the canonical form; the duplicate is left alone rather than
-- the migration failing.
UPDATE `sponsor_purchases` SET `email` = lower(trim(`email`)) WHERE `email` <> lower(trim(`email`));--> statement-breakpoint
UPDATE `quote_requests` SET `email` = lower(trim(`email`)) WHERE `email` <> lower(trim(`email`));--> statement-breakpoint
UPDATE `magic_links` SET `email` = lower(trim(`email`)) WHERE `email` <> lower(trim(`email`));--> statement-breakpoint
UPDATE OR IGNORE `waitlist` SET `email` = lower(trim(`email`)) WHERE `email` <> lower(trim(`email`));--> statement-breakpoint
UPDATE OR IGNORE `org_members` SET `owner_email` = lower(trim(`owner_email`)), `member_email` = lower(trim(`member_email`)), `invited_by` = lower(trim(`invited_by`)) WHERE `owner_email` <> lower(trim(`owner_email`)) OR `member_email` <> lower(trim(`member_email`)) OR `invited_by` <> lower(trim(`invited_by`));
