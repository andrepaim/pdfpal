import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("PDFPAL_DB", Path(__file__).resolve().parent / "pdfpal.db"))

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
