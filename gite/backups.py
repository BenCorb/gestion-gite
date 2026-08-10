from __future__ import annotations

import logging
import os
import re
import sqlite3
import threading
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


logger = logging.getLogger("gite.backups")

BACKUP_INTERVAL_SECONDS = 60 * 60
BACKUP_TIMESTAMP_FORMAT = "%Y%m%dT%H%M%SZ"
BACKUP_FILENAME_PATTERN = re.compile(r"^backup-(\d{8}T\d{6}Z)\.sqlite3$")


def normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def backup_filename(created_at: datetime) -> str:
    timestamp = normalize_utc(created_at).strftime(BACKUP_TIMESTAMP_FORMAT)
    return f"backup-{timestamp}.sqlite3"


def parse_backup_timestamp(path: Path) -> datetime | None:
    match = BACKUP_FILENAME_PATTERN.fullmatch(path.name)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1), BACKUP_TIMESTAMP_FORMAT).replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def _validate_backup(conn: sqlite3.Connection) -> None:
    result = conn.execute("PRAGMA quick_check").fetchone()
    if result is None or result[0] != "ok":
        detail = result[0] if result else "aucun résultat"
        raise RuntimeError(f"La validation SQLite de la sauvegarde a échoué : {detail}")


def create_database_backup(
    database_path: Path,
    backup_dir: Path,
    *,
    created_at: datetime | None = None,
) -> Path:
    database_path = Path(database_path)
    backup_dir = Path(backup_dir)
    if not database_path.is_file():
        raise FileNotFoundError(f"Base SQLite introuvable : {database_path}")

    created_at = normalize_utc(created_at or datetime.now(timezone.utc))
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / backup_filename(created_at)
    temporary = backup_dir / f".{target.name}.{uuid.uuid4().hex}.tmp"

    try:
        temporary.touch(mode=0o600, exist_ok=False)
        with sqlite3.connect(database_path) as source, sqlite3.connect(temporary) as destination:
            source.execute("PRAGMA busy_timeout = 5000")
            source.backup(destination)
            _validate_backup(destination)
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def _recent_months(now: datetime, count: int) -> set[tuple[int, int]]:
    months = set()
    year = now.year
    month = now.month
    for _ in range(count):
        months.add((year, month))
        month -= 1
        if month == 0:
            year -= 1
            month = 12
    return months


def retained_backup_paths(backup_dir: Path, *, now: datetime | None = None) -> set[Path]:
    backup_dir = Path(backup_dir)
    now = normalize_utc(now or datetime.now(timezone.utc))
    if not backup_dir.exists():
        return set()

    snapshots = []
    for path in backup_dir.iterdir():
        if not path.is_file():
            continue
        timestamp = parse_backup_timestamp(path)
        if timestamp is not None:
            snapshots.append((timestamp, path))

    allowed_hours = {
        (now - timedelta(hours=offset)).replace(minute=0, second=0, microsecond=0)
        for offset in range(24)
    }
    allowed_days = {(now - timedelta(days=offset)).date() for offset in range(7)}
    allowed_months = _recent_months(now, 6)

    latest_by_hour: dict[datetime, tuple[datetime, Path]] = {}
    latest_by_day: dict[date, tuple[datetime, Path]] = {}
    latest_by_month: dict[tuple[int, int], tuple[datetime, Path]] = {}

    for timestamp, path in snapshots:
        hour = timestamp.replace(minute=0, second=0, microsecond=0)
        day = timestamp.date()
        month = (timestamp.year, timestamp.month)
        if hour in allowed_hours and (
            hour not in latest_by_hour or timestamp > latest_by_hour[hour][0]
        ):
            latest_by_hour[hour] = (timestamp, path)
        if day in allowed_days and (
            day not in latest_by_day or timestamp > latest_by_day[day][0]
        ):
            latest_by_day[day] = (timestamp, path)
        if month in allowed_months and (
            month not in latest_by_month or timestamp > latest_by_month[month][0]
        ):
            latest_by_month[month] = (timestamp, path)

    return {
        path
        for _timestamp, path in (
            *latest_by_hour.values(),
            *latest_by_day.values(),
            *latest_by_month.values(),
        )
    }


def prune_database_backups(backup_dir: Path, *, now: datetime | None = None) -> list[Path]:
    backup_dir = Path(backup_dir)
    keep = retained_backup_paths(backup_dir, now=now)
    deleted = []
    if not backup_dir.exists():
        return deleted

    for path in backup_dir.iterdir():
        if not path.is_file() or parse_backup_timestamp(path) is None or path in keep:
            continue
        path.unlink()
        deleted.append(path)
    return deleted


def run_backup_cycle(
    database_path: Path,
    backup_dir: Path,
    *,
    now: datetime | None = None,
) -> Path:
    cycle_time = normalize_utc(now or datetime.now(timezone.utc))
    target = create_database_backup(database_path, backup_dir, created_at=cycle_time)
    deleted = prune_database_backups(backup_dir, now=cycle_time)
    logger.info("Sauvegarde SQLite créée : %s", target)
    if deleted:
        logger.info("%d ancienne(s) sauvegarde(s) supprimée(s).", len(deleted))
    return target


class BackupScheduler:
    def __init__(
        self,
        database_path: Path,
        backup_dir: Path,
        *,
        interval_seconds: float = BACKUP_INTERVAL_SECONDS,
        backup_cycle: Callable[..., Path] = run_backup_cycle,
    ) -> None:
        if interval_seconds <= 0:
            raise ValueError("L'intervalle de sauvegarde doit être positif.")
        self.database_path = Path(database_path)
        self.backup_dir = Path(backup_dir)
        self.interval_seconds = interval_seconds
        self.backup_cycle = backup_cycle
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.is_running:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="gite-database-backup",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join()
        self._thread = None

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.backup_cycle(self.database_path, self.backup_dir)
            except Exception:
                logger.exception("Échec de la sauvegarde SQLite automatique.")
            if self._stop_event.wait(self.interval_seconds):
                break
