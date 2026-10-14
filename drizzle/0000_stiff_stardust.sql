CREATE TABLE `race_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`time_ms` integer NOT NULL,
	`level` text NOT NULL,
	`players` integer NOT NULL,
	`rules` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_race_scores_rules_time` ON `race_scores` (`rules`,`time_ms`);