"""Small persistent key/value store for admin-editable runtime settings
(currently just the T-Invest token and instrument cap), backed by the same
mounted volume as the live-arm audit log so values survive redeploys.
"""
import os
import sqlite3
from pathlib import Path

DB = Path(os.getenv('SETTINGS_DB', str(Path(__file__).resolve().parent / 'data' / 'settings.db')))

def _conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return con

def get(key, default=None):
    try:
        con = _conn()
        row = con.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        con.close()
        return row[0] if row else default
    except sqlite3.Error:
        return default

def set(key, value):
    con = _conn()
    con.execute('INSERT INTO settings(key,value) VALUES (?,?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
    con.commit()
    con.close()
