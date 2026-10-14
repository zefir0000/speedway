import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const scores = sqliteTable('race_scores', {
 id: text('id').primaryKey(),
 name: text('name').notNull(),
 timeMs: integer('time_ms').notNull(),
 level: text('level').notNull(),
 players: integer('players').notNull(),
 track: text('track').notNull().default('classic'),
 rules: integer('rules').notNull(),
 createdAt: text('created_at').notNull()
}, table => [index('idx_race_scores_rules_time').on(table.rules, table.timeMs), index('idx_race_scores_track_rules_time').on(table.track, table.rules, table.timeMs)]);

export const campaigns = sqliteTable('gp_campaigns', {
 id: text('id').primaryKey(),
 state: text('state').notNull(),
 revision: integer('revision').notNull(),
 createdAt: text('created_at').notNull(),
 updatedAt: text('updated_at').notNull()
}, table => [index('idx_gp_campaigns_updated').on(table.updatedAt)]);

export const onlineQueue = sqliteTable('online_queue', {
 id: text('id').primaryKey(),
 data: text('data').notNull(),
 revision: integer('revision').notNull(),
 updatedAt: integer('updated_at').notNull()
});
export const onlineRooms = sqliteTable('online_rooms', {
 id: text('id').primaryKey(),
 data: text('data').notNull(),
 revision: integer('revision').notNull(),
 expiresAt: integer('expires_at').notNull()
}, table => [index('idx_online_rooms_expiry').on(table.expiresAt)]);
