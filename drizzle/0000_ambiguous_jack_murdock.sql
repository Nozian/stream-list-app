CREATE TABLE `watchlist_items` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`service` text NOT NULL,
	`type` text NOT NULL,
	`genre` text NOT NULL,
	`href` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`watched` integer DEFAULT false NOT NULL,
	`star` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_watchlist_items_user_updated` ON `watchlist_items` (`user_id`,`updated_at`);
--> statement-breakpoint
PRAGMA optimize;
