import os
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from gite import backups


UTC = timezone.utc


class DatabaseBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.database_path = self.root / "source.sqlite3"
        self.backup_dir = self.root / "backups"
        with sqlite3.connect(self.database_path) as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("CREATE TABLE reservations (id TEXT PRIMARY KEY, guest TEXT NOT NULL)")
            conn.execute("INSERT INTO reservations VALUES (?, ?)", ("r-1", "Alice"))

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_create_database_backup_is_valid_atomic_and_private(self):
        created_at = datetime(2026, 8, 10, 14, 0, tzinfo=UTC)

        with mock.patch("gite.backups.os.replace", wraps=os.replace) as replace:
            target = backups.create_database_backup(
                self.database_path,
                self.backup_dir,
                created_at=created_at,
            )

        self.assertEqual(target.name, "backup-20260810T140000Z.sqlite3")
        replace.assert_called_once()
        self.assertTrue(target.is_file())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.backup_dir.glob(".*.tmp")), [])
        with sqlite3.connect(target) as conn:
            self.assertEqual(conn.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(
                conn.execute("SELECT id, guest FROM reservations").fetchone(),
                ("r-1", "Alice"),
            )

    def test_validation_failure_removes_temporary_file_without_publishing(self):
        with mock.patch(
            "gite.backups._validate_backup",
            side_effect=RuntimeError("invalid backup"),
        ):
            with self.assertRaisesRegex(RuntimeError, "invalid backup"):
                backups.create_database_backup(self.database_path, self.backup_dir)

        self.assertEqual(list(self.backup_dir.iterdir()), [])

    def test_failed_creation_does_not_prune_existing_backups(self):
        with (
            mock.patch(
                "gite.backups.create_database_backup",
                side_effect=sqlite3.OperationalError("disk full"),
            ),
            mock.patch("gite.backups.prune_database_backups") as prune,
        ):
            with self.assertRaisesRegex(sqlite3.OperationalError, "disk full"):
                backups.run_backup_cycle(self.database_path, self.backup_dir)

        prune.assert_not_called()

    def test_retention_keeps_latest_hour_day_and_month_across_year_boundary(self):
        now = datetime(2026, 1, 2, 12, 30, tzinfo=UTC)
        timestamps = [
            "20260102T120000Z",
            "20260102T122000Z",
            "20260102T110500Z",
            "20260101T100000Z",
            "20260101T220000Z",
            "20251231T080000Z",
            "20251231T180000Z",
            "20251230T180000Z",
            "20251229T180000Z",
            "20251228T180000Z",
            "20251227T180000Z",
            "20251226T180000Z",
            "20251101T080000Z",
            "20251130T180000Z",
            "20251031T180000Z",
            "20250930T180000Z",
            "20250831T180000Z",
            "20250731T180000Z",
        ]
        self.backup_dir.mkdir()
        paths = {}
        for timestamp in timestamps:
            path = self.backup_dir / f"backup-{timestamp}.sqlite3"
            path.touch()
            paths[timestamp] = path
        unrelated = self.backup_dir / "notes.txt"
        unrelated.write_text("keep me", encoding="utf-8")

        deleted = backups.prune_database_backups(self.backup_dir, now=now)

        expected_kept = {
            "20260102T122000Z",
            "20260102T110500Z",
            "20260101T220000Z",
            "20251231T180000Z",
            "20251230T180000Z",
            "20251229T180000Z",
            "20251228T180000Z",
            "20251227T180000Z",
            "20251130T180000Z",
            "20251031T180000Z",
            "20250930T180000Z",
            "20250831T180000Z",
        }
        self.assertEqual(
            {timestamp for timestamp, path in paths.items() if path.exists()},
            expected_kept,
        )
        self.assertEqual(
            {path.name for path in deleted},
            {f"backup-{timestamp}.sqlite3" for timestamp in set(timestamps) - expected_kept},
        )
        self.assertTrue(unrelated.exists())


class BackupSchedulerTests(unittest.TestCase):
    def test_scheduler_runs_immediately_repeats_and_stops(self):
        second_cycle = threading.Event()
        calls = []

        def cycle(database_path, backup_dir):
            calls.append((database_path, backup_dir))
            if len(calls) >= 2:
                second_cycle.set()
            return backup_dir / "backup.sqlite3"

        scheduler = backups.BackupScheduler(
            Path("database.sqlite3"),
            Path("backups"),
            interval_seconds=0.01,
            backup_cycle=cycle,
        )

        scheduler.start()
        self.assertTrue(second_cycle.wait(1), "Le second cycle ne s'est pas exécuté.")
        scheduler.stop()
        calls_after_stop = len(calls)
        time.sleep(0.03)

        self.assertGreaterEqual(calls_after_stop, 2)
        self.assertEqual(len(calls), calls_after_stop)
        self.assertFalse(scheduler.is_running)

    def test_scheduler_retries_after_a_failed_cycle(self):
        retried = threading.Event()
        calls = 0

        def cycle(_database_path, backup_dir):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise sqlite3.OperationalError("temporary failure")
            retried.set()
            return backup_dir / "backup.sqlite3"

        scheduler = backups.BackupScheduler(
            Path("database.sqlite3"),
            Path("backups"),
            interval_seconds=0.01,
            backup_cycle=cycle,
        )

        with self.assertLogs("gite.backups", level="ERROR"):
            scheduler.start()
            self.assertTrue(retried.wait(1), "Le cycle n'a pas été retenté.")
            scheduler.stop()

        self.assertGreaterEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
