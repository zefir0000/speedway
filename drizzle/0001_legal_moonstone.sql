ALTER TABLE `race_scores` ADD `track` text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_race_scores_track_rules_time` ON `race_scores` (`track`,`rules`,`time_ms`);