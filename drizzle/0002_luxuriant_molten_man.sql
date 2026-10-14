CREATE TABLE `gp_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_gp_campaigns_updated` ON `gp_campaigns` (`updated_at`);