import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).with_name("stats.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                joined_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                blocked INTEGER DEFAULT 0,
                clicked INTEGER DEFAULT 0,
                click_count INTEGER DEFAULT 0,
                games_count INTEGER DEFAULT 0,
                last_reason TEXT
            )
            """
        )
        conn.commit()


def upsert_user(user_id, username=None, first_name=None):
    now = int(time.time())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO users(user_id, username, first_name, joined_at, last_seen_at)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                username=excluded.username,
                first_name=excluded.first_name,
                last_seen_at=excluded.last_seen_at
            """,
            (user_id, username, first_name, now, now),
        )
        conn.commit()


def mark_game_event(user_id, games_count=0, reason=None):
    upsert_user(user_id)
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET games_count = MAX(games_count, ?),
                last_reason = COALESCE(?, last_reason),
                last_seen_at = ?
            WHERE user_id = ?
            """,
            (int(games_count or 0), reason, int(time.time()), user_id),
        )
        conn.commit()


def mark_blocked(user_id, games_count=0, reason=None):
    upsert_user(user_id)
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET blocked = 1,
                games_count = MAX(games_count, ?),
                last_reason = COALESCE(?, last_reason),
                last_seen_at = ?
            WHERE user_id = ?
            """,
            (int(games_count or 0), reason, int(time.time()), user_id),
        )
        conn.commit()


def mark_clicked(user_id):
    upsert_user(user_id)
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET clicked = 1,
                click_count = click_count + 1,
                last_seen_at = ?
            WHERE user_id = ?
            """,
            (int(time.time()), user_id),
        )
        conn.commit()


def stats():
    day_ago = int(time.time()) - 24 * 60 * 60
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        users_24h = conn.execute("SELECT COUNT(*) FROM users WHERE joined_at >= ?", (day_ago,)).fetchone()[0]
        clicked = conn.execute("SELECT COUNT(*) FROM users WHERE clicked = 1").fetchone()[0]
        blocked = conn.execute("SELECT COUNT(*) FROM users WHERE blocked = 1").fetchone()[0]
        not_clicked = conn.execute("SELECT COUNT(*) FROM users WHERE clicked = 0").fetchone()[0]

    return {
        "total": total,
        "users_24h": users_24h,
        "clicked": clicked,
        "blocked": blocked,
        "not_clicked": not_clicked,
    }


def not_clicked_users():
    with get_connection() as conn:
        rows = conn.execute("SELECT user_id FROM users WHERE clicked = 0").fetchall()
    return [row["user_id"] for row in rows]


def reset_players():
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET blocked = 0,
                clicked = 0,
                click_count = 0,
                games_count = 0,
                last_reason = NULL
            """
        )
        conn.commit()


def reset_player(user_id):
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET blocked = 0,
                clicked = 0,
                click_count = 0,
                games_count = 0,
                last_reason = NULL
            WHERE user_id = ?
            """,
            (user_id,),
        )
        conn.commit()
