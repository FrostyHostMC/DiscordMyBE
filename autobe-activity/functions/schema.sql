-- Community Modpacks Database Schema
-- Stores modpacks published by users for community download

CREATE TABLE IF NOT EXISTS community_modpacks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  author TEXT NOT NULL,
  author_id TEXT NOT NULL,
  version TEXT NOT NULL,
  total_packs INTEGER NOT NULL,
  size INTEGER NOT NULL,
  icon_data_url TEXT,
  created_at INTEGER NOT NULL,
  downloads INTEGER DEFAULT 0,
  blob_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  included_packs TEXT -- JSON array of pack info
);

CREATE INDEX IF NOT EXISTS idx_community_modpacks_created_at ON community_modpacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_modpacks_author_id ON community_modpacks(author_id);
CREATE INDEX IF NOT EXISTS idx_community_modpacks_downloads ON community_modpacks(downloads DESC);
