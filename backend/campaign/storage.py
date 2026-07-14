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
    plot_cost_usd          REAL    NOT NULL DEFAULT 0,
    generation_cost_usd    REAL    NOT NULL DEFAULT 0,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The rough, high-level story guide: a flat parent chain seeded at campaign creation (see
-- save_campaign). Branching into multiple candidate next points via parent_plot_point_id, and
-- transitioning status past 'upcoming', is live-play behavior with no writer yet in this pass.
CREATE TABLE IF NOT EXISTS major_plot_points (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id           INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    parent_plot_point_id  INTEGER REFERENCES major_plot_points(id) ON DELETE SET NULL,
    title                 TEXT    NOT NULL,
    summary               TEXT    NOT NULL,
    status                TEXT    NOT NULL DEFAULT 'upcoming',   -- upcoming | active | reached | abandoned
    created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turns (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id            INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    turn_index             INTEGER NOT NULL,
    content                TEXT    NOT NULL,
    author                 TEXT    NOT NULL DEFAULT 'dm',   -- 'dm' (narration, AI-drafted or hand-written) | 'player'
    reached_plot_point_id  INTEGER REFERENCES major_plot_points(id) ON DELETE SET NULL,
    audio_chunks           TEXT,                             -- JSON [{url, isNewParagraph}, ...], DM turns only
    created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (campaign_id, turn_index)
);

CREATE TABLE IF NOT EXISTS npcs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id        INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name               TEXT    NOT NULL,
    personality        TEXT    NOT NULL DEFAULT '',
    backstory          TEXT    NOT NULL DEFAULT '',
    motivations        TEXT    NOT NULL DEFAULT '',
    current_status     TEXT    NOT NULL DEFAULT '',   -- free text: alive/dead, location, mood
    relationships      TEXT    NOT NULL DEFAULT '{}', -- JSON, keyed by npc/player name
    secrets            TEXT    NOT NULL DEFAULT '',   -- hidden from players, informs AI reactions
    source             TEXT    NOT NULL,              -- 'setup' | 'auto' | 'manual'
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (campaign_id, name COLLATE NOCASE)
);

-- Per-campaign dynamic world knowledge, distinct from the static global world_knowledge/ files
-- (campaign/world_knowledge.py), which stay app-wide shared lore and aren't changing.
CREATE TABLE IF NOT EXISTS campaign_lore (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    category       TEXT    NOT NULL,   -- location | faction | item | history | rule
    title          TEXT    NOT NULL,
    content        TEXT    NOT NULL,
    source         TEXT    NOT NULL,   -- 'setup' | 'auto' | 'manual'
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Structured puzzle definitions (see campaign/puzzles.py), authored only in the new-campaign
-- wizard and seeded at campaign save. Mid-session play creates puzzle_sessions (later phase),
-- never new puzzles.
CREATE TABLE IF NOT EXISTS puzzles (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    plot_point_id  INTEGER REFERENCES major_plot_points(id) ON DELETE SET NULL,
    title          TEXT    NOT NULL,
    archetype      TEXT    NOT NULL,
    presentation   TEXT    NOT NULL,   -- 'map' | 'text'
    definition     TEXT    NOT NULL,   -- JSON PuzzleDefinition
    source         TEXT    NOT NULL,   -- 'detected' | 'template' | 'custom'
    status         TEXT    NOT NULL DEFAULT 'ready',   -- 'ready' | 'published' | 'retired'
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Per-user plot-textarea history (new-campaign wizard "Generate Plot"/"Improve Prompt" undo).
-- No campaign_id: this happens before a campaign exists.
CREATE TABLE IF NOT EXISTS plot_drafts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    source        TEXT    NOT NULL,   -- 'written' | 'generated' | 'improved'
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(campaigns_db_path), exist_ok=True)
    conn = sqlite3.connect(campaigns_db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """CREATE TABLE IF NOT EXISTS won't add new columns/drop old columns for a DB that already
    exists on disk from an earlier run — patch those in by hand.
    """
    conn.execute("DROP TABLE IF EXISTS chapters")
    conn.execute("DROP TABLE IF EXISTS sessions")

    campaign_columns = [row[1] for row in conn.execute("PRAGMA table_info(campaigns)")]
    if "plot_cost_usd" not in campaign_columns:
        conn.execute("ALTER TABLE campaigns ADD COLUMN plot_cost_usd REAL NOT NULL DEFAULT 0")
    if "generation_cost_usd" not in campaign_columns:
        conn.execute("ALTER TABLE campaigns ADD COLUMN generation_cost_usd REAL NOT NULL DEFAULT 0")
    if "chapter_count" in campaign_columns:
        conn.execute("ALTER TABLE campaigns DROP COLUMN chapter_count")
    if "sessions_per_chapter" in campaign_columns:
        conn.execute("ALTER TABLE campaigns DROP COLUMN sessions_per_chapter")

    turn_columns = [row[1] for row in conn.execute("PRAGMA table_info(turns)")]
    if "author" not in turn_columns:
        conn.execute("ALTER TABLE turns ADD COLUMN author TEXT NOT NULL DEFAULT 'dm'")
    if "reached_plot_point_id" not in turn_columns:
        conn.execute(
            "ALTER TABLE turns ADD COLUMN reached_plot_point_id "
            "INTEGER REFERENCES major_plot_points(id) ON DELETE SET NULL"
        )
    if "audio_chunks" not in turn_columns:
        conn.execute("ALTER TABLE turns ADD COLUMN audio_chunks TEXT")


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)


def save_campaign(
    user_id: str,
    model: str,
    title: str,
    plot: str,
    campaign_type: str,
    plot_points: list[dict],
    plot_cost: float,
    generation_cost: float,
    puzzles: list[dict] | None = None,
) -> int:
    """Persists the campaign and seeds `major_plot_points` as a flat parent chain in the order
    given — branching/regenerating that chain dynamically during play is a later, live-play
    concern (see the plot_points table comment in SCHEMA above).

    `puzzles` entries are {"plotPointIndex": int|None, "source": str, "definition": dict};
    plotPointIndex resolves against the plot points seeded in this same transaction.
    """
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO campaigns (
                user_id, title, plot, model, campaign_type, plot_cost_usd, generation_cost_usd
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, title, plot, model, campaign_type, plot_cost, generation_cost),
        )
        campaign_id = cursor.lastrowid

        parent_id = None
        plot_point_ids = []
        for point in plot_points:
            point_cursor = conn.execute(
                """
                INSERT INTO major_plot_points (campaign_id, parent_plot_point_id, title, summary)
                VALUES (?, ?, ?, ?)
                """,
                (campaign_id, parent_id, point["title"], point["summary"]),
            )
            parent_id = point_cursor.lastrowid
            plot_point_ids.append(parent_id)

        for puzzle in puzzles or []:
            definition = puzzle["definition"]
            index = puzzle.get("plotPointIndex")
            plot_point_id = (
                plot_point_ids[index]
                if index is not None and 0 <= index < len(plot_point_ids)
                else None
            )
            conn.execute(
                """
                INSERT INTO puzzles (
                    campaign_id, plot_point_id, title, archetype, presentation, definition, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    campaign_id, plot_point_id, definition["title"], definition["archetype"],
                    definition["presentation"], json.dumps(definition), puzzle["source"],
                ),
            )

        return campaign_id


def _row_to_puzzle(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "campaignId": row["campaign_id"],
        "plotPointId": row["plot_point_id"],
        "title": row["title"],
        "archetype": row["archetype"],
        "presentation": row["presentation"],
        "definition": json.loads(row["definition"]),
        "source": row["source"],
        "status": row["status"],
        "createdAt": row["created_at"],
    }


def list_puzzles(campaign_id: int) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM puzzles WHERE campaign_id = ? ORDER BY id ASC", (campaign_id,)
        ).fetchall()
        return [_row_to_puzzle(row) for row in rows]


def get_puzzle(puzzle_id: int) -> dict | None:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM puzzles WHERE id = ?", (puzzle_id,)).fetchone()
        return _row_to_puzzle(row) if row else None


def set_puzzle_status(puzzle_id: int, status: str) -> None:
    with _connect() as conn:
        conn.execute("UPDATE puzzles SET status = ? WHERE id = ?", (status, puzzle_id))


def _row_to_campaign_summary(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "title": row["title"],
        "plot": row["plot"],
        "model": row["model"],
        "campaignType": row["campaign_type"],
        "createdAt": row["created_at"],
    }


def list_campaigns_for_user(user_id: str) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
        return [_row_to_campaign_summary(row) for row in rows]


def get_campaign(campaign_id: int) -> dict | None:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
        return _row_to_campaign_summary(row) if row else None


def _row_to_plot_point(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "parentPlotPointId": row["parent_plot_point_id"],
        "title": row["title"],
        "summary": row["summary"],
        "status": row["status"],
        "createdAt": row["created_at"],
    }


def list_plot_points(campaign_id: int) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM major_plot_points WHERE campaign_id = ? ORDER BY id ASC", (campaign_id,)
        ).fetchall()
        return [_row_to_plot_point(row) for row in rows]


def get_current_plot_point(campaign_id: int) -> dict | None:
    """The plot point to steer narration/branch options toward: the earliest not-yet-reached
    point in insertion order. Nothing transitions a point's status past 'upcoming' yet (that's a
    live-play decision, not wired to any handler in this pass) — until it is, this is simply the
    first plot point seeded for the campaign, which is still a reasonable steering target.
    """
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT * FROM major_plot_points
            WHERE campaign_id = ? AND status IN ('upcoming', 'active')
            ORDER BY id ASC LIMIT 1
            """,
            (campaign_id,),
        ).fetchone()
        return _row_to_plot_point(row) if row else None


def turns_since_last_plot_point(campaign_id: int) -> int:
    """Pacing signal: how many turns have been published since the last one that resolved a
    major plot point, computed on the fly rather than via a separate counter column. Until
    something sets turns.reached_plot_point_id, this simply grows from the start of the
    campaign — a reasonable default in the absence of that live-play trigger.
    """
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT reached_plot_point_id FROM turns WHERE campaign_id = ? ORDER BY turn_index DESC",
            (campaign_id,),
        ).fetchall()

    count = 0
    for row in rows:
        if row["reached_plot_point_id"] is not None:
            break
        count += 1
    return count


def _row_to_turn(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "turnIndex": row["turn_index"],
        "content": row["content"],
        "author": row["author"],
        "reachedPlotPointId": row["reached_plot_point_id"],
        "audioChunks": json.loads(row["audio_chunks"]) if row["audio_chunks"] else None,
        "createdAt": row["created_at"],
    }


def list_turns(campaign_id: int) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM turns WHERE campaign_id = ? ORDER BY turn_index ASC", (campaign_id,)
        ).fetchall()
        return [_row_to_turn(row) for row in rows]


def add_turn(
    campaign_id: int,
    content: str,
    author: str = "dm",
    reached_plot_point_id: int | None = None,
) -> dict:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        next_index = conn.execute(
            "SELECT COUNT(*) AS n FROM turns WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()["n"]
        cursor = conn.execute(
            """
            INSERT INTO turns (campaign_id, turn_index, content, author, reached_plot_point_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (campaign_id, next_index, content, author, reached_plot_point_id),
        )
        row = conn.execute("SELECT * FROM turns WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _row_to_turn(row)


def set_turn_audio_chunks(turn_id: int, chunks: list[dict]) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE turns SET audio_chunks = ? WHERE id = ?", (json.dumps(chunks), turn_id)
        )


def _row_to_npc(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "personality": row["personality"],
        "backstory": row["backstory"],
        "motivations": row["motivations"],
        "currentStatus": row["current_status"],
        "relationships": json.loads(row["relationships"]),
        "secrets": row["secrets"],
        "source": row["source"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_npcs(campaign_id: int) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM npcs WHERE campaign_id = ? ORDER BY id ASC", (campaign_id,)
        ).fetchall()
        return [_row_to_npc(row) for row in rows]


def add_npc(
    campaign_id: int,
    name: str,
    source: str,
    personality: str = "",
    backstory: str = "",
    motivations: str = "",
    current_status: str = "",
    relationships: dict | None = None,
    secrets: str = "",
) -> dict | None:
    """Returns None instead of raising if `name` already exists for this campaign. The
    campaign_id+name uniqueness constraint is a backstop against concurrent auto-extraction races
    (see session_handlers._auto_extract_npcs_and_lore, which holds a per-campaign lock and
    re-checks existing names before calling this) — a collision here means a race slipped past
    that guard, not the normal path.
    """
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(
                """
                INSERT INTO npcs (
                    campaign_id, name, personality, backstory, motivations, current_status,
                    relationships, secrets, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    campaign_id, name, personality, backstory, motivations, current_status,
                    json.dumps(relationships or {}), secrets, source,
                ),
            )
        except sqlite3.IntegrityError:
            return None
        row = conn.execute("SELECT * FROM npcs WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _row_to_npc(row)


def update_npc(
    npc_id: int,
    personality: str | None = None,
    backstory: str | None = None,
    motivations: str | None = None,
    current_status: str | None = None,
    relationships: dict | None = None,
    secrets: str | None = None,
) -> None:
    """Only columns passed a non-None value are updated — lets a caller patch e.g. just
    current_status after a scene without clobbering the rest of the record."""
    values = {
        "personality": personality,
        "backstory": backstory,
        "motivations": motivations,
        "current_status": current_status,
        "relationships": json.dumps(relationships) if relationships is not None else None,
        "secrets": secrets,
    }
    updates = {column: value for column, value in values.items() if value is not None}
    if not updates:
        return

    set_clause = ", ".join(f"{column} = ?" for column in updates) + ", updated_at = datetime('now')"
    with _connect() as conn:
        conn.execute(f"UPDATE npcs SET {set_clause} WHERE id = ?", (*updates.values(), npc_id))


def _row_to_lore(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "category": row["category"],
        "title": row["title"],
        "content": row["content"],
        "source": row["source"],
        "createdAt": row["created_at"],
    }


def list_lore(campaign_id: int) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM campaign_lore WHERE campaign_id = ? ORDER BY id ASC", (campaign_id,)
        ).fetchall()
        return [_row_to_lore(row) for row in rows]


def add_lore(campaign_id: int, category: str, title: str, content: str, source: str) -> dict:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            """
            INSERT INTO campaign_lore (campaign_id, category, title, content, source)
            VALUES (?, ?, ?, ?, ?)
            """,
            (campaign_id, category, title, content, source),
        )
        row = conn.execute("SELECT * FROM campaign_lore WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _row_to_lore(row)


def _row_to_plot_draft(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "content": row["content"],
        "source": row["source"],
        "createdAt": row["created_at"],
    }


def list_plot_drafts(user_id: str) -> list[dict]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM plot_drafts WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
        ).fetchall()
        return [_row_to_plot_draft(row) for row in rows]


def add_plot_draft(user_id: str, content: str, source: str) -> dict:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "INSERT INTO plot_drafts (user_id, content, source) VALUES (?, ?, ?)",
            (user_id, content, source),
        )
        row = conn.execute("SELECT * FROM plot_drafts WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return _row_to_plot_draft(row)
