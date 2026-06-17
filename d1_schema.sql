CREATE TABLE IF NOT EXISTS players (
  user_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 10,
  locked INTEGER NOT NULL DEFAULT 0,
  clicked_partner INTEGER NOT NULL DEFAULT 0,
  clicked_at INTEGER,
  reset_nonce TEXT NOT NULL DEFAULT '',
  trigger_after INTEGER NOT NULL DEFAULT 3,
  last_result TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_first_seen ON players(first_seen);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen);
CREATE INDEX IF NOT EXISTS idx_players_clicked_partner ON players(clicked_partner);
CREATE INDEX IF NOT EXISTS idx_players_locked ON players(locked);
