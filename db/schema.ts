import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const watchlistItems = sqliteTable('watchlist_items', {
  userId: text('user_id').notNull(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  service: text('service').notNull(),
  type: text('type').notNull(),
  genre: text('genre').notNull(),
  href: text('href').notNull().default(''),
  memo: text('memo').notNull().default(''),
  watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
  star: integer('star').notNull().default(0),
  addedAt: integer('added_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index('idx_watchlist_items_user_updated').on(table.userId, table.updatedAt),
]);
