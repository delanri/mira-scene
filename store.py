"""SQLite 存储：生图任务、每轮对话记录、前端事件（打断/重试/超时）。

只用 Python 自带的 sqlite3，不需要安装任何东西。数据库文件默认在 data/mira.db（已 gitignore）。
多线程安全：每次操作新开连接 + 一把全局锁（访问量很小，够用且简单）。
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.getenv("MIRA_DB_PATH", Path(__file__).parent / "data" / "mira.db"))
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS photo_jobs (
    id          TEXT PRIMARY KEY,
    created_at  REAL NOT NULL,
    prompt      TEXT NOT NULL,
    caption     TEXT,
    cache_key   TEXT NOT NULL,
    provider    TEXT NOT NULL,
    status      TEXT NOT NULL,          -- queued / running / done / failed
    image_file  TEXT,                   -- static/generated/ 下的文件名
    cached      INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    started_at  REAL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS idx_photo_cache ON photo_jobs(cache_key, status);

CREATE TABLE IF NOT EXISTS turns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  REAL NOT NULL,
    request_id  TEXT,
    mode        TEXT,                   -- mock / live / fallback
    affinity    INTEGER,
    user_text   TEXT,
    reply_text  TEXT,
    emotion     TEXT,
    action      TEXT,
    scene       TEXT,
    latency_ms  INTEGER,                -- 后端处理这一轮花的时间（含调模型）
    attempts    INTEGER,                -- 调了几次模型（格式坏了会重试）
    error       TEXT,
    photo_job   TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  REAL NOT NULL,
    request_id  TEXT,
    type        TEXT NOT NULL,          -- interrupt / retry / timeout / network_error / stt_error
    detail      TEXT
);
"""


@contextmanager
def _connect():
    """开连接 → 用完提交 → 一定关掉。

    注意 sqlite3 自己的 `with conn:` 只负责提交 / 回滚，不会关连接，
    不关的话 Python 3.13+ 会报 ResourceWarning: unclosed database。
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with conn:  # 提交 / 出错回滚
            yield conn
    finally:
        conn.close()


def init_db():
    with _lock, _connect() as conn:
        conn.executescript(SCHEMA)


def execute(sql: str, params=()):
    with _lock, _connect() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid


def query(sql: str, params=()) -> list:
    with _lock, _connect() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def query_one(sql: str, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


# ---------------------------------------------------------------- 对话 / 事件
def log_turn(**fields):
    fields.setdefault("created_at", time.time())
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    execute(f"INSERT INTO turns ({cols}) VALUES ({marks})", tuple(fields.values()))


def log_event(type_: str, request_id: str = None, detail: str = None):
    execute(
        "INSERT INTO events (created_at, request_id, type, detail) VALUES (?, ?, ?, ?)",
        (time.time(), request_id, type_, detail),
    )


init_db()
