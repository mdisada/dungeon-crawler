"""SQLite persistence for generated campaigns."""
import json
import os
import sqlite3

from config.file_paths import campaigns_db_path

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                TEXT    NOT NULL,
    title                  TEXT,
    plot                   TEXT    NOT NULL,
    model                  TEXT    NOT NULL,
    campaign_type          TEXT    NOT NULL,   -- 'one-shot' | 'multi-chapter'
    chapter_count          INTEGER NOT NULL,   -- exact count actually generated
    sessions_per_chapter   INTEGER NOT NULL,   -- exact count actually generated (uniform per chapter)
    plot_cost_usd          REAL    NOT NULL DEFAULT 0,
    outline_cost_usd       REAL    NOT NULL DEFAULT 0,
    locked                 INTEGER NOT NULL DEFAULT 0,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    chapter_index  INTEGER NOT NULL,
    title          TEXT    NOT NULL,
    big_goal       TEXT    NOT NULL,
    twists         TEXT    NOT NULL,
    locked         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (campaign_id, chapter_index)
);

CREATE TABLE IF NOT EXISTS sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id        INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    session_index     INTEGER NOT NULL,
    hook              TEXT    NOT NULL,
    conflict_climax   TEXT    NOT NULL,
    cliffhanger       TEXT    NOT NULL,
    locked            INTEGER NOT NULL DEFAULT 0,
    UNIQUE (chapter_id, session_index)
);
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(campaigns_db_path), exist_ok=True)
    conn = sqlite3.connect(campaigns_db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)


def _chapter_lock(locks: dict | None, chapter_index: int) -> bool:
    if not locks:
        return False
    chapters = locks.get("chapters", [])
    if chapter_index >= len(chapters):
        return False
    return bool(chapters[chapter_index].get("locked", False))


def _session_lock(locks: dict | None, chapter_index: int, session_index: int) -> bool:
    if not locks:
        return False
    chapters = locks.get("chapters", [])
    if chapter_index >= len(chapters):
        return False
    sessions = chapters[chapter_index].get("sessions", [])
    if session_index >= len(sessions):
        return False
    return bool(sessions[session_index])


def save_campaign(
    user_id: str,
    model: str,
    plot: str,
    outline: dict,
    campaign_type: str,
    chapter_count: int,
    sessions_per_chapter: int,
    plot_cost: float,
    outline_cost: float,
    locks: dict | None = None,
) -> int:
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO campaigns (
                user_id, plot, model, campaign_type, chapter_count,
                sessions_per_chapter, plot_cost_usd, outline_cost_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id, plot, model, campaign_type, chapter_count,
                sessions_per_chapter, plot_cost, outline_cost,
            ),
        )
        campaign_id = cursor.lastrowid

        for chapter_index, chapter in enumerate(outline.get("chapters", [])):
            chapter_cursor = conn.execute(
                """
                INSERT INTO chapters (campaign_id, chapter_index, title, big_goal, twists, locked)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    campaign_id, chapter_index, chapter["title"], chapter["bigGoal"],
                    json.dumps(chapter.get("twists", [])),
                    _chapter_lock(locks, chapter_index),
                ),
            )
            chapter_id = chapter_cursor.lastrowid

            for session_index, session in enumerate(chapter.get("sessions", [])):
                conn.execute(
                    """
                    INSERT INTO sessions (chapter_id, session_index, hook, conflict_climax, cliffhanger, locked)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chapter_id, session_index, session["hook"],
                        session["conflictClimax"], session["cliffhanger"],
                        _session_lock(locks, chapter_index, session_index),
                    ),
                )

        return campaign_id
