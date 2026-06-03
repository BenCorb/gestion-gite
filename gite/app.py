from __future__ import annotations

import collections
import json
import logging
import os
import re
import socket
import sqlite3
import sys
import threading
import time
import uuid
import webbrowser
import hashlib
import hmac
import secrets
import smtplib
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from datetime import datetime, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_FILE = Path(os.environ.get("GITE_DB", DATA_DIR / "reservations.sqlite3"))
UPLOADS_DIR = DATA_DIR / "uploads"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
SESSION_COOKIE_NAME = "gite_admin_session"
SESSION_DAYS = int(os.environ.get("GITE_SESSION_DAYS", "7"))
ADMIN_ROOT_PATHS = {"/gestion", "/gestion/"}
ADMIN_APP_PATH = "/gestion/app"
ADMIN_LOGIN_PATH = "/gestion/"
LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_UPLOAD_SIZE = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S")
logger = logging.getLogger("gite")

# Rate-limit anti-brute-force du login, stocké en mémoire process : adapté à un déploiement
# mono-instance. Remis à zéro au redémarrage et non partagé entre plusieurs processus/répliques
# (pour un scale horizontal, basculer ce compteur vers une table SQLite ou un store partagé).
_login_attempts: dict[str, list[float]] = collections.defaultdict(list)
_login_lock = threading.Lock()


DEFAULT_SETTINGS = {
    "propertyName": "Mon gîte",
    "description": "",
    "currency": "EUR",
    "rooms": [
        {"id": "chambre-1", "name": "Chambre 1", "color": "#98c7a3", "bookingRequestsEnabled": True},
        {"id": "chambre-2", "name": "Chambre 2", "color": "#e6c28b", "bookingRequestsEnabled": True},
        {"id": "chambre-3", "name": "Chambre 3", "color": "#9dbdd7", "bookingRequestsEnabled": True},
    ],
    "platforms": ["Airbnb", "Booking", "GreenGo"],
    "site": {
        "logoUrl": "",
        "heroImageUrl": "",
        "headline": "Bienvenue dans notre gîte",
        "subtitle": "Un séjour confortable, simple à réserver.",
        "intro": "Découvrez nos chambres et envoyez une demande selon les disponibilités.",
        "address": "",
        "phone": "",
        "email": "",
        "giteTitle": "Le gîte",
        "giteDescription": "",
        "gitePhotos": [],
        "bodyFont": "lato",
        "headingFont": "playfair",
    },
    "notifications": {
        "notifyEmail": "",
        "smtpHost": "",
        "smtpPort": "587",
        "smtpUser": "",
        "smtpPassword": "",
    },
}

DEFAULT_RESERVATIONS = {"reservations": []}
DEFAULT_ROOM_COLORS = ["#98c7a3", "#e6c28b", "#9dbdd7", "#d8a7a7", "#b8abd8", "#95c8c0"]
ALLOWED_RESERVATION_STATUSES = {"pending", "confirmed", "paid", "cancelled"}
DIRECT_BOOKING_PLATFORM = "Réservation directe"
DATA_LOCK = threading.RLock()


_DB_READY = False


def ensure_database() -> None:
    # Idempotent et coûteux (executescript + migrations + initialize_*) : ne l'exécuter
    # qu'une fois. main() l'appelle au démarrage ; les appels par-requête deviennent no-op.
    global _DB_READY
    if _DB_READY:
        return
    DATA_DIR.mkdir(exist_ok=True)
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                property_name TEXT NOT NULL,
                description TEXT NOT NULL,
                currency TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                public_visible INTEGER NOT NULL DEFAULT 1,
                booking_requests_enabled INTEGER NOT NULL DEFAULT 1,
                summary TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                capacity INTEGER NOT NULL DEFAULT 2,
                price TEXT NOT NULL DEFAULT '',
                amenities TEXT NOT NULL DEFAULT '[]',
                amenity_groups TEXT NOT NULL DEFAULT '[]',
                booking_links TEXT NOT NULL DEFAULT '[]',
                sort_order INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS room_photos (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                url TEXT NOT NULL,
                alt TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS site_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS platforms (
                name TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reservations (
                id TEXT PRIMARY KEY,
                group_id TEXT,
                booking_type TEXT NOT NULL,
                status TEXT NOT NULL,
                booking_name TEXT NOT NULL,
                room_id TEXT NOT NULL,
                arrival_date TEXT NOT NULL,
                departure_date TEXT NOT NULL,
                client_name TEXT NOT NULL,
                client_contact TEXT NOT NULL,
                platform TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS booking_requests (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                arrival_date TEXT NOT NULL,
                departure_date TEXT NOT NULL,
                guest_name TEXT NOT NULL,
                guest_contact TEXT NOT NULL,
                guest_count INTEGER NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(room_id) REFERENCES rooms(id)
            );

            CREATE TABLE IF NOT EXISTS admin_auth (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                password_hash TEXT NOT NULL,
                session_revision TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                session_revision TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_reservations_room_id ON reservations(room_id);
            CREATE INDEX IF NOT EXISTS idx_reservations_arrival_date ON reservations(arrival_date);
            CREATE INDEX IF NOT EXISTS idx_reservations_group_id ON reservations(group_id);
            CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
            CREATE INDEX IF NOT EXISTS idx_rooms_sort_order ON rooms(sort_order);
            CREATE INDEX IF NOT EXISTS idx_platforms_sort_order ON platforms(sort_order);
            CREATE INDEX IF NOT EXISTS idx_room_photos_room_id ON room_photos(room_id);
            CREATE INDEX IF NOT EXISTS idx_booking_requests_room_id ON booking_requests(room_id);
            CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);
            """
        )
        migrate_database(conn)
        initialize_meta(conn)
        settings_count = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
        if settings_count == 0:
            import_initial_data(conn)
        initialize_site_settings(conn)
        initialize_notification_settings(conn)
        initialize_admin_auth(conn)
        purge_expired_sessions(conn)
        conn.commit()
    _DB_READY = True


def initialize_meta(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)",
        [
            ("settings_revision", "1"),
            ("reservations_revision", "1"),
            ("booking_requests_revision", "1"),
        ],
    )


def migrate_database(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(rooms)").fetchall()}
    migrations = {
        "public_visible": "ALTER TABLE rooms ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 1",
        "booking_requests_enabled": "ALTER TABLE rooms ADD COLUMN booking_requests_enabled INTEGER NOT NULL DEFAULT 1",
        "summary": "ALTER TABLE rooms ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
        "description": "ALTER TABLE rooms ADD COLUMN description TEXT NOT NULL DEFAULT ''",
        "capacity": "ALTER TABLE rooms ADD COLUMN capacity INTEGER NOT NULL DEFAULT 2",
        "price": "ALTER TABLE rooms ADD COLUMN price TEXT NOT NULL DEFAULT ''",
        "amenities": "ALTER TABLE rooms ADD COLUMN amenities TEXT NOT NULL DEFAULT '[]'",
        "amenity_groups": "ALTER TABLE rooms ADD COLUMN amenity_groups TEXT NOT NULL DEFAULT '[]'",
        "booking_links": "ALTER TABLE rooms ADD COLUMN booking_links TEXT NOT NULL DEFAULT '[]'",
    }
    for column, statement in migrations.items():
        if column not in columns:
            conn.execute(statement)

    session_cols = {row["name"] for row in conn.execute("PRAGMA table_info(admin_sessions)").fetchall()}
    if "expires_at" not in session_cols:
        conn.execute("ALTER TABLE admin_sessions ADD COLUMN expires_at TEXT")
        # Expire existing sessions immediately so re-login is required after upgrade.
        conn.execute("UPDATE admin_sessions SET expires_at = ?", (datetime.now().isoformat(timespec="seconds"),))

    # Purge des enfants orphelins laissés par les cascades FK historiquement inertes.
    conn.execute("DELETE FROM room_photos WHERE room_id NOT IN (SELECT id FROM rooms)")
    conn.execute("DELETE FROM booking_requests WHERE room_id NOT IN (SELECT id FROM rooms)")


def initialize_site_settings(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO site_settings(key, value) VALUES(?, ?)",
        [(key, json.dumps(value, ensure_ascii=False)) for key, value in DEFAULT_SETTINGS["site"].items()],
    )


def initialize_notification_settings(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO notification_settings(key, value) VALUES(?, ?)",
        [(key, json.dumps(value, ensure_ascii=False)) for key, value in DEFAULT_SETTINGS["notifications"].items()],
    )


def initialize_admin_auth(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT id FROM admin_auth WHERE id = 1").fetchone()
    if existing:
        return
    password = os.environ.get("ADMIN_INITIAL_PASSWORD")
    if not password:
        password = secrets.token_urlsafe(12)
        logger.warning("Mot de passe admin initial généré automatiquement : %s", password)
        logger.warning("Définissez la variable ADMIN_INITIAL_PASSWORD pour choisir votre mot de passe.")
    conn.execute(
        "INSERT INTO admin_auth(id, password_hash, session_revision) VALUES(1, ?, ?)",
        (hash_password(password), uuid.uuid4().hex),
    )


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    # WAL + busy_timeout : meilleure concurrence lecture/écriture sous ThreadingHTTPServer.
    # foreign_keys : sans ce PRAGMA, les "ON DELETE CASCADE" du schéma sont inertes.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
        ).fetchone()
        is not None
    )


def import_initial_data(conn: sqlite3.Connection) -> None:
    settings = validate_settings(DEFAULT_SETTINGS)
    reservations = rebuild_reservations(DEFAULT_RESERVATIONS["reservations"], settings)
    write_settings_db(conn, settings)
    write_reservations_db(conn, reservations)


def redact_settings_for_client(settings: dict) -> dict:
    """Ne jamais renvoyer le mot de passe SMTP au navigateur ; exposer seulement un booléen."""
    notifications = dict(settings.get("notifications", {}))
    notifications["smtpConfigured"] = bool(str(notifications.get("smtpPassword", "")).strip())
    notifications["smtpPassword"] = ""
    return {**settings, "notifications": notifications}


def load_state() -> dict:
    ensure_database()
    with get_connection() as conn:
        return {
            "settings": redact_settings_for_client(fetch_settings(conn)),
            "reservations": fetch_reservations(conn),
            "bookingRequests": fetch_booking_requests(conn),
            "versions": get_versions(conn),
        }


def get_versions(conn: sqlite3.Connection | None = None) -> dict:
    ensure_database()
    owns_connection = conn is None
    if conn is None:
        conn = get_connection()
    try:
        rows = conn.execute("SELECT key, value FROM meta").fetchall()
        values = {row["key"]: row["value"] for row in rows}
        return {
            "settingsVersion": values.get("settings_revision", "1"),
            "reservationsVersion": values.get("reservations_revision", "1"),
            "bookingRequestsVersion": values.get("booking_requests_revision", "1"),
        }
    finally:
        if owns_connection:
            conn.close()


def bump_version(conn: sqlite3.Connection, key: str) -> None:
    current = int(
        conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()["value"]
    )
    conn.execute("UPDATE meta SET value = ? WHERE key = ?", (str(current + 1), key))


def assert_expected_versions(payload: dict, current_versions: dict) -> None:
    expected_versions = payload.get("_versions") or {}
    expected_settings = str(expected_versions.get("settingsVersion", "")).strip()
    expected_reservations = str(expected_versions.get("reservationsVersion", "")).strip()

    if not expected_settings or not expected_reservations:
        raise ValueError("Versions de synchronisation manquantes.")

    if (
        expected_settings != current_versions["settingsVersion"]
        or expected_reservations != current_versions["reservationsVersion"]
    ):
        raise ConflictError("Les données ont été modifiées depuis un autre appareil. Recharge la page.")


def get_versions_from_headers(headers) -> dict:
    return {
        "settingsVersion": headers.get("X-Settings-Version", ""),
        "reservationsVersion": headers.get("X-Reservations-Version", ""),
        "bookingRequestsVersion": headers.get("X-Booking-Requests-Version", ""),
    }


def normalize_settings(settings: dict) -> dict:
    site = settings.get("site", DEFAULT_SETTINGS["site"])
    platforms = normalize_string_list(settings.get("platforms", DEFAULT_SETTINGS["platforms"]))
    if DIRECT_BOOKING_PLATFORM.lower() not in {platform.lower() for platform in platforms}:
        platforms.append(DIRECT_BOOKING_PLATFORM)
    merged = {
        "propertyName": settings.get("propertyName", DEFAULT_SETTINGS["propertyName"]),
        "description": settings.get("description", DEFAULT_SETTINGS["description"]),
        "currency": settings.get("currency", DEFAULT_SETTINGS["currency"]),
        "platforms": platforms,
        "site": normalize_site_settings(site),
        "notifications": normalize_notification_settings(settings.get("notifications", {})),
        "rooms": [],
    }
    for index, room in enumerate(settings.get("rooms", DEFAULT_SETTINGS["rooms"])):
        merged["rooms"].append(
            {
                "id": room.get("id", f"room-{index + 1}"),
                "name": room.get("name", f"Chambre {index + 1}"),
                "color": room.get("color") or DEFAULT_ROOM_COLORS[index % len(DEFAULT_ROOM_COLORS)],
                "publicVisible": bool(room.get("publicVisible", True)),
                "bookingRequestsEnabled": bool(room.get("bookingRequestsEnabled", True)),
                "summary": str(room.get("summary", "")).strip(),
                "description": str(room.get("description", "")).strip(),
                "capacity": max(1, int(room.get("capacity", 2) or 2)),
                "price": str(room.get("price", "")).strip(),
                "amenities": normalize_string_list(room.get("amenities", [])),
                "amenityGroups": normalize_amenity_groups(room.get("amenityGroups"), room.get("amenities", [])),
                "bookingLinks": normalize_booking_links(room.get("bookingLinks", [])),
                "photos": normalize_photos(room.get("photos", [])),
            }
        )
    return merged


VALID_BODY_FONTS = {"lato", "raleway", "opensans", "nunito", "librefranklin"}
VALID_HEADING_FONTS = {"playfair", "cormorant", "montserrat", "baskerville", "satisfy", "patrickhand", "librefranklin"}


def normalize_site_settings(site: dict) -> dict:
    return {
        "logoUrl": str(site.get("logoUrl", "")).strip(),
        "heroImageUrl": str(site.get("heroImageUrl", "")).strip(),
        "headline": str(site.get("headline", DEFAULT_SETTINGS["site"]["headline"])).strip()
        or DEFAULT_SETTINGS["site"]["headline"],
        "subtitle": str(site.get("subtitle", DEFAULT_SETTINGS["site"]["subtitle"])).strip(),
        "intro": str(site.get("intro", DEFAULT_SETTINGS["site"]["intro"])).strip(),
        "address": str(site.get("address", "")).strip(),
        "phone": str(site.get("phone", "")).strip(),
        "email": str(site.get("email", "")).strip(),
        "giteTitle": str(site.get("giteTitle", "Le gîte")).strip() or "Le gîte",
        "giteDescription": str(site.get("giteDescription", "")).strip(),
        "gitePhotos": normalize_photos(site.get("gitePhotos", [])),
        "bodyFont": site.get("bodyFont", "lato") if site.get("bodyFont", "lato") in VALID_BODY_FONTS else "lato",
        "headingFont": site.get("headingFont", "playfair") if site.get("headingFont", "playfair") in VALID_HEADING_FONTS else "playfair",
    }


def normalize_string_list(values) -> list[str]:
    if isinstance(values, str):
        values = values.split(",")
    if not isinstance(values, list):
        return []
    normalized = []
    seen = set()
    for value in values:
        item = str(value).strip()
        key = item.lower()
        if item and key not in seen:
            seen.add(key)
            normalized.append(item)
    return normalized


def normalize_amenity_groups(groups, legacy_amenities=None) -> list[dict]:
    normalized = []
    if isinstance(groups, list):
        for group in groups:
            if isinstance(group, str):
                name = group.strip()
                items = []
            else:
                name = str(group.get("name", "")).strip()
                items = normalize_string_list(group.get("items", []))
            if name and items:
                normalized.append({"name": name, "items": items})

    if normalized:
        return normalized

    legacy_items = normalize_string_list(legacy_amenities or [])
    if legacy_items:
        return [{"name": "Équipements", "items": legacy_items}]

    return []


def normalize_photos(values) -> list[dict]:
    if not isinstance(values, list):
        return []
    photos = []
    for photo in values:
        if isinstance(photo, str):
            url = photo.strip()
            alt = ""
        else:
            url = str(photo.get("url", "")).strip()
            alt = str(photo.get("alt", "")).strip()
        if url:
            photos.append({"url": url, "alt": alt})
    return photos


def normalize_booking_links(values) -> list[dict]:
    if not isinstance(values, list):
        return []
    links = []
    seen = set()
    for item in values:
        if isinstance(item, str):
            label = "Réserver"
            url = item.strip()
        else:
            label = str(item.get("label", "")).strip() or "Réserver"
            url = str(item.get("url", "")).strip()
        if not url or url in seen:
            continue
        seen.add(url)
        links.append({"label": label, "url": url})
    return links


def normalize_reservations(reservations: list[dict]) -> list[dict]:
    normalized = []
    for reservation in reservations:
        booking_type = str(reservation.get("bookingType", "reservation")).strip() or "reservation"
        status = str(reservation.get("status", "confirmed")).strip() or "confirmed"
        if booking_type == "block":
            status = "blocked"
        elif status not in ALLOWED_RESERVATION_STATUSES:
            status = "confirmed"
        normalized.append(
            {
                **reservation,
                "bookingType": booking_type,
                "status": status,
            }
        )
    return normalized


def fetch_settings(conn: sqlite3.Connection) -> dict:
    base = conn.execute(
        "SELECT property_name, description, currency FROM settings WHERE id = 1"
    ).fetchone()
    rooms = conn.execute(
        """
        SELECT id, name, color, public_visible, booking_requests_enabled, summary, description, capacity, price,
               amenities, amenity_groups, booking_links
        FROM rooms
        ORDER BY sort_order, name
        """
    ).fetchall()
    platforms = conn.execute(
        "SELECT name FROM platforms ORDER BY sort_order, name"
    ).fetchall()
    photos_by_room = fetch_room_photos(conn)
    site = fetch_site_settings(conn)
    notifications = fetch_notification_settings(conn)
    return normalize_settings(
        {
            "propertyName": base["property_name"],
            "description": base["description"],
            "currency": base["currency"],
            "site": site,
            "notifications": notifications,
            "rooms": [
                {
                    "id": room["id"],
                    "name": room["name"],
                    "color": room["color"],
                    "publicVisible": bool(room["public_visible"]),
                    "bookingRequestsEnabled": bool(room["booking_requests_enabled"]),
                    "summary": room["summary"],
                    "description": room["description"],
                    "capacity": room["capacity"],
                    "price": room["price"],
                    "amenities": json.loads(room["amenities"] or "[]"),
                    "amenityGroups": json.loads(room["amenity_groups"] or "[]"),
                    "bookingLinks": json.loads(room["booking_links"] or "[]"),
                    "photos": photos_by_room.get(room["id"], []),
                }
                for room in rooms
            ],
            "platforms": [row["name"] for row in platforms],
        }
    )


def fetch_room_photos(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    rows = conn.execute(
        "SELECT room_id, url, alt FROM room_photos ORDER BY sort_order, id"
    ).fetchall()
    photos_by_room: dict[str, list[dict]] = {}
    for row in rows:
        photos_by_room.setdefault(row["room_id"], []).append({"url": row["url"], "alt": row["alt"]})
    return photos_by_room


def fetch_site_settings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT key, value FROM site_settings").fetchall()
    settings = dict(DEFAULT_SETTINGS["site"])
    for row in rows:
        try:
            settings[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            settings[row["key"]] = row["value"]
    return normalize_site_settings(settings)


def normalize_notification_settings(notif: dict) -> dict:
    port = str(notif.get("smtpPort", "587")).strip()
    return {
        "notifyEmail":  str(notif.get("notifyEmail", "")).strip(),
        "smtpHost":     str(notif.get("smtpHost", "")).strip(),
        "smtpPort":     port if port.isdigit() else "587",
        "smtpUser":     str(notif.get("smtpUser", "")).strip(),
        "smtpPassword": str(notif.get("smtpPassword", "")).strip(),
    }


def fetch_notification_settings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT key, value FROM notification_settings").fetchall()
    raw = {**DEFAULT_SETTINGS["notifications"]}
    for row in rows:
        try:
            raw[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            raw[row["key"]] = row["value"]
    return normalize_notification_settings(raw)


def sync_notification_settings_db(conn: sqlite3.Connection, notif: dict) -> None:
    normalized = normalize_notification_settings(notif)
    # « Laisser vide pour conserver » : un smtpPassword vide ne doit pas écraser le secret stocké.
    if not normalized["smtpPassword"]:
        row = conn.execute(
            "SELECT value FROM notification_settings WHERE key = 'smtpPassword'"
        ).fetchone()
        if row:
            try:
                normalized["smtpPassword"] = json.loads(row["value"])
            except json.JSONDecodeError:
                normalized["smtpPassword"] = row["value"]
    conn.executemany(
        "INSERT OR REPLACE INTO notification_settings(key, value) VALUES(?, ?)",
        [(k, json.dumps(v, ensure_ascii=False)) for k, v in normalized.items()],
    )


def fetch_reservations(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
            id,
            group_id,
            booking_type,
            status,
            booking_name,
            room_id,
            arrival_date,
            departure_date,
            client_name,
            client_contact,
            platform,
            amount,
            comment,
            created_at,
            updated_at
        FROM reservations
        ORDER BY arrival_date, created_at, id
        """
    ).fetchall()
    return normalize_reservations(
        [
            {
                "id": row["id"],
                "groupId": row["group_id"],
                "bookingType": row["booking_type"],
                "status": row["status"],
                "bookingName": row["booking_name"],
                "roomId": row["room_id"],
                "arrivalDate": row["arrival_date"],
                "departureDate": row["departure_date"],
                "clientName": row["client_name"],
                "clientContact": row["client_contact"],
                "platform": row["platform"],
                "amount": row["amount"],
                "comment": row["comment"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]
    )


def fetch_booking_requests(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, room_id, arrival_date, departure_date, guest_name, guest_contact,
               guest_count, message, status, created_at, updated_at
        FROM booking_requests
        ORDER BY created_at DESC, id
        """
    ).fetchall()
    return [
        {
            "id": row["id"],
            "roomId": row["room_id"],
            "arrivalDate": row["arrival_date"],
            "departureDate": row["departure_date"],
            "guestName": row["guest_name"],
            "guestContact": row["guest_contact"],
            "guestCount": row["guest_count"],
            "message": row["message"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def fetch_booking_request_by_id(conn: sqlite3.Connection, request_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, room_id, arrival_date, departure_date, guest_name, guest_contact,
               guest_count, message, status, created_at, updated_at
        FROM booking_requests WHERE id = ?
        """,
        (request_id,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "roomId": row["room_id"],
        "arrivalDate": row["arrival_date"],
        "departureDate": row["departure_date"],
        "guestName": row["guest_name"],
        "guestContact": row["guest_contact"],
        "guestCount": row["guest_count"],
        "message": row["message"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def validate_booking_request(payload: dict, settings: dict, reservations: list[dict]) -> dict:
    room_id = str(payload.get("roomId", "")).strip()
    arrival_date = str(payload.get("arrivalDate", "")).strip()
    departure_date = str(payload.get("departureDate", "")).strip()
    guest_name = str(payload.get("guestName", "")).strip()
    guest_contact = str(payload.get("guestContact", "")).strip()
    message = str(payload.get("message", "")).strip()
    try:
        guest_count = max(1, int(payload.get("guestCount", 1) or 1))
    except (TypeError, ValueError):
        guest_count = 1

    room = next(
        (
            item
            for item in settings["rooms"]
            if item["id"] == room_id
            and item.get("publicVisible", True)
            and item.get("bookingRequestsEnabled", True)
        ),
        None,
    )
    if not room:
        raise ValueError("La chambre sélectionnée n'est pas disponible à la demande.")
    if not guest_name or not guest_contact:
        raise ValueError("Nom et contact sont requis pour envoyer une demande.")
    validate_date_range(arrival_date, departure_date)
    if not is_room_available(room_id, arrival_date, departure_date, reservations):
        raise ValueError("Cette chambre n'est plus disponible pour ces dates.")

    now = datetime.now().isoformat(timespec="seconds")
    return {
        "id": uuid.uuid4().hex,
        "roomId": room_id,
        "roomName": room["name"],
        "arrivalDate": arrival_date,
        "departureDate": departure_date,
        "guestName": guest_name,
        "guestContact": guest_contact,
        "guestCount": guest_count,
        "message": message,
        "status": "new",
        "createdAt": now,
        "updatedAt": now,
    }


def insert_booking_request_db(conn: sqlite3.Connection, request: dict) -> None:
    conn.execute(
        """
        INSERT INTO booking_requests(
            id, room_id, arrival_date, departure_date, guest_name, guest_contact,
            guest_count, message, status, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            request["id"],
            request["roomId"],
            request["arrivalDate"],
            request["departureDate"],
            request["guestName"],
            request["guestContact"],
            request["guestCount"],
            request["message"],
            request["status"],
            request["createdAt"],
            request["updatedAt"],
        ),
    )


def update_booking_request_status_db(conn: sqlite3.Connection, request_id: str, status: str) -> None:
    conn.execute(
        "UPDATE booking_requests SET status = ?, updated_at = ? WHERE id = ?",
        (status, datetime.now().isoformat(timespec="seconds"), request_id),
    )


def build_cancelled_reservation_from_request(request: dict) -> dict:
    now = datetime.now().isoformat(timespec="seconds")
    return {
        "id": uuid.uuid4().hex,
        "groupId": None,
        "bookingType": "reservation",
        "status": "cancelled",
        "bookingName": request["guestName"],
        "roomId": request["roomId"],
        "arrivalDate": request["arrivalDate"],
        "departureDate": request["departureDate"],
        "clientName": request["guestName"],
        "clientContact": request["guestContact"],
        "platform": DIRECT_BOOKING_PLATFORM,
        "amount": 0.0,
        "comment": request["message"] or "",
        "createdAt": now,
        "updatedAt": now,
    }


def build_reservation_payload_from_request(request: dict, payload: dict, settings: dict) -> dict:
    edited = payload.get("reservation") if isinstance(payload.get("reservation"), dict) else {}
    return {
        "bookingType": "reservation",
        "status": str(edited.get("status", "pending")).strip() or "pending",
        "roomId": str(edited.get("roomId", request["roomId"])).strip(),
        "arrivalDate": str(edited.get("arrivalDate", request["arrivalDate"])).strip(),
        "departureDate": str(edited.get("departureDate", request["departureDate"])).strip(),
        "clientName": str(edited.get("clientName", request["guestName"])).strip(),
        "clientContact": str(edited.get("clientContact", request["guestContact"])).strip(),
        "platform": DIRECT_BOOKING_PLATFORM,
        "amount": float(edited.get("amount", 0) or 0),
        "comment": str(edited.get("comment", request["message"])).strip(),
    }


def validate_date_range(arrival_date: str, departure_date: str) -> None:
    try:
        arrival = datetime.strptime(arrival_date, "%Y-%m-%d")
        departure = datetime.strptime(departure_date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("Dates invalides.") from exc
    if departure <= arrival:
        raise ValueError("La date de départ doit être après la date d'arrivée.")


def periods_overlap(arrival1, departure1, arrival2, departure2) -> bool:
    """Vrai si [arrival1, departure1) et [arrival2, departure2) se chevauchent."""
    return arrival1 < departure2 and departure1 > arrival2


def is_room_available(room_id: str, arrival_date: str, departure_date: str, reservations: list[dict]) -> bool:
    arrival = datetime.strptime(arrival_date, "%Y-%m-%d")
    departure = datetime.strptime(departure_date, "%Y-%m-%d")
    for reservation in reservations:
        if reservation["roomId"] != room_id:
            continue
        if str(reservation.get("status", "")).strip() == "cancelled":
            continue
        existing_arrival = datetime.strptime(reservation["arrivalDate"], "%Y-%m-%d")
        existing_departure = datetime.strptime(reservation["departureDate"], "%Y-%m-%d")
        if periods_overlap(arrival, departure, existing_arrival, existing_departure):
            return False
    return True


def is_room_available_db(conn: sqlite3.Connection, room_id: str, arrival_date: str, departure_date: str) -> bool:
    count = conn.execute(
        """
        SELECT COUNT(*) FROM reservations
        WHERE room_id = ? AND status != 'cancelled'
          AND arrival_date < ? AND departure_date > ?
        """,
        (room_id, departure_date, arrival_date),
    ).fetchone()[0]
    return count == 0


def build_public_site(conn: sqlite3.Connection) -> dict:
    settings = fetch_settings(conn)
    return {
        "propertyName": settings["propertyName"],
        "description": settings["description"],
        "currency": settings["currency"],
        "site": settings["site"],
        "rooms": [room for room in settings["rooms"] if room.get("publicVisible", True)],
    }


def build_availability(conn: sqlite3.Connection, arrival_date: str, departure_date: str) -> dict:
    validate_date_range(arrival_date, departure_date)
    settings = fetch_settings(conn)
    available_rooms = [
        room
        for room in settings["rooms"]
        if room.get("publicVisible", True)
        and is_room_available_db(conn, room["id"], arrival_date, departure_date)
    ]
    return {"arrivalDate": arrival_date, "departureDate": departure_date, "rooms": available_rooms}


def write_settings_db(conn: sqlite3.Connection, settings: dict) -> None:
    upsert_settings_db(conn, settings)
    sync_rooms_db(conn, settings["rooms"])
    sync_platforms_db(conn, settings["platforms"])
    sync_site_settings_db(conn, settings["site"])
    sync_notification_settings_db(conn, settings.get("notifications", {}))


def upsert_settings_db(conn: sqlite3.Connection, settings: dict) -> None:
    conn.execute(
        """
        INSERT INTO settings(id, property_name, description, currency)
        VALUES(1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            property_name = excluded.property_name,
            description = excluded.description,
            currency = excluded.currency
        """,
        (
            settings["propertyName"],
            settings["description"],
            settings["currency"],
        ),
    )


def sync_rooms_db(conn: sqlite3.Connection, rooms: list[dict]) -> None:
    conn.executemany(
        """
        INSERT INTO rooms(
            id, name, color, public_visible, booking_requests_enabled, summary, description, capacity, price,
            amenities, amenity_groups, booking_links, sort_order
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            public_visible = excluded.public_visible,
            booking_requests_enabled = excluded.booking_requests_enabled,
            summary = excluded.summary,
            description = excluded.description,
            capacity = excluded.capacity,
            price = excluded.price,
            amenities = excluded.amenities,
            amenity_groups = excluded.amenity_groups,
            booking_links = excluded.booking_links,
            sort_order = excluded.sort_order
        """,
        [
            (
                room["id"],
                room["name"],
                room["color"],
                1 if room.get("publicVisible", True) else 0,
                1 if room.get("bookingRequestsEnabled", True) else 0,
                room.get("summary", ""),
                room.get("description", ""),
                int(room.get("capacity", 2) or 2),
                room.get("price", ""),
                json.dumps(room.get("amenities", []), ensure_ascii=False),
                json.dumps(room.get("amenityGroups", []), ensure_ascii=False),
                json.dumps(room.get("bookingLinks", []), ensure_ascii=False),
                index,
            )
            for index, room in enumerate(rooms)
        ],
    )
    sync_room_photos_db(conn, rooms)
    keep_ids = {room["id"] for room in rooms}
    removed_ids = [
        row["id"]
        for row in conn.execute("SELECT id FROM rooms").fetchall()
        if row["id"] not in keep_ids
    ]
    has_requests = _table_exists(conn, "booking_requests")
    for room_id in removed_ids:
        # Supprimer explicitement les enfants avant la chambre : room_photos (sinon orphelins)
        # et booking_requests (FK RESTRICT → bloquerait la suppression avec foreign_keys = ON).
        conn.execute("DELETE FROM room_photos WHERE room_id = ?", (room_id,))
        if has_requests:
            conn.execute("DELETE FROM booking_requests WHERE room_id = ?", (room_id,))
        conn.execute("DELETE FROM rooms WHERE id = ?", (room_id,))


def sync_room_photos_db(conn: sqlite3.Connection, rooms: list[dict]) -> None:
    room_ids = {room["id"] for room in rooms}
    conn.executemany(
        "DELETE FROM room_photos WHERE room_id = ?",
        [(room_id,) for room_id in room_ids],
    )
    rows = []
    for room in rooms:
        for index, photo in enumerate(room.get("photos", [])):
            rows.append((uuid.uuid4().hex, room["id"], photo["url"], photo.get("alt", ""), index))
    conn.executemany(
        "INSERT INTO room_photos(id, room_id, url, alt, sort_order) VALUES(?, ?, ?, ?, ?)",
        rows,
    )


def sync_site_settings_db(conn: sqlite3.Connection, site: dict) -> None:
    normalized = normalize_site_settings(site)
    conn.execute(
        f"DELETE FROM site_settings WHERE key NOT IN ({','.join('?' for _ in normalized)})",
        tuple(normalized.keys()),
    )
    conn.executemany(
        """
        INSERT INTO site_settings(key, value)
        VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        [(key, json.dumps(value, ensure_ascii=False)) for key, value in normalized.items()],
    )


def sync_platforms_db(conn: sqlite3.Connection, platforms: list[str]) -> None:
    conn.executemany(
        """
        INSERT INTO platforms(name, sort_order)
        VALUES(?, ?)
        ON CONFLICT(name) DO UPDATE SET
            sort_order = excluded.sort_order
        """,
        [(platform, index) for index, platform in enumerate(platforms)],
    )
    conn.executemany(
        "DELETE FROM platforms WHERE name = ?",
        [(row["name"],) for row in conn.execute("SELECT name FROM platforms").fetchall() if row["name"] not in set(platforms)],
    )


def write_reservations_db(conn: sqlite3.Connection, reservations: list[dict]) -> None:
    conn.execute("DELETE FROM reservations")
    upsert_reservations_db(conn, reservations)


def reservation_to_db_row(reservation: dict) -> tuple:
    return (
        reservation["id"],
        reservation.get("groupId"),
        reservation["bookingType"],
        reservation["status"],
        reservation["bookingName"],
        reservation["roomId"],
        reservation["arrivalDate"],
        reservation["departureDate"],
        reservation["clientName"],
        reservation["clientContact"],
        reservation["platform"],
        float(reservation["amount"]),
        reservation["comment"],
        reservation["createdAt"],
        reservation["updatedAt"],
    )


def upsert_reservations_db(conn: sqlite3.Connection, reservations: list[dict]) -> None:
    if not reservations:
        return
    conn.executemany(
        """
        INSERT INTO reservations(
            id,
            group_id,
            booking_type,
            status,
            booking_name,
            room_id,
            arrival_date,
            departure_date,
            client_name,
            client_contact,
            platform,
            amount,
            comment,
            created_at,
            updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            group_id = excluded.group_id,
            booking_type = excluded.booking_type,
            status = excluded.status,
            booking_name = excluded.booking_name,
            room_id = excluded.room_id,
            arrival_date = excluded.arrival_date,
            departure_date = excluded.departure_date,
            client_name = excluded.client_name,
            client_contact = excluded.client_contact,
            platform = excluded.platform,
            amount = excluded.amount,
            comment = excluded.comment,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        """,
        [reservation_to_db_row(reservation) for reservation in reservations],
    )


def delete_reservation_db(conn: sqlite3.Connection, reservation_id: str) -> None:
    conn.execute("DELETE FROM reservations WHERE id = ?", (reservation_id,))


def delete_reservations_by_group_db(conn: sqlite3.Connection, group_id: str) -> None:
    conn.execute("DELETE FROM reservations WHERE group_id = ?", (group_id,))


def validate_settings(payload: dict) -> dict:
    property_name = str(payload.get("propertyName", "")).strip()
    currency = str(payload.get("currency", "EUR")).strip().upper() or "EUR"
    description = str(payload.get("description", "")).strip()
    rooms = payload.get("rooms", [])
    platforms = payload.get("platforms", [])

    if not property_name:
        raise ValueError("Le nom du gîte est requis.")
    if not rooms:
        raise ValueError("Au moins une chambre est requise.")
    if not platforms:
        raise ValueError("Au moins une plateforme est requise.")

    normalized_rooms = []
    seen_room_ids = set()
    seen_room_names = set()
    for room in rooms:
        room_id = str(room.get("id", "")).strip() or f"room-{uuid.uuid4().hex[:8]}"
        room_name = str(room.get("name", "")).strip()
        room_color = str(room.get("color", "")).strip() or DEFAULT_ROOM_COLORS[
            len(normalized_rooms) % len(DEFAULT_ROOM_COLORS)
        ]
        if not room_name:
            continue
        if room_id in seen_room_ids or room_name.lower() in seen_room_names:
            raise ValueError("Chaque chambre doit être unique.")
        if room_color not in DEFAULT_ROOM_COLORS:
            raise ValueError("Chaque chambre doit utiliser une couleur pastel proposée.")
        seen_room_ids.add(room_id)
        seen_room_names.add(room_name.lower())
        try:
            capacity = max(1, int(room.get("capacity", 2) or 2))
        except (TypeError, ValueError):
            capacity = 2
        normalized_rooms.append(
            {
                "id": room_id,
                "name": room_name,
                "color": room_color,
                "publicVisible": bool(room.get("publicVisible", True)),
                "bookingRequestsEnabled": bool(room.get("bookingRequestsEnabled", True)),
                "summary": str(room.get("summary", "")).strip(),
                "description": str(room.get("description", "")).strip(),
                "capacity": capacity,
                "price": str(room.get("price", "")).strip(),
                "amenities": normalize_string_list(room.get("amenities", [])),
                "amenityGroups": normalize_amenity_groups(room.get("amenityGroups"), room.get("amenities", [])),
                "bookingLinks": normalize_booking_links(room.get("bookingLinks", [])),
                "photos": normalize_photos(room.get("photos", [])),
            }
        )

    normalized_platforms = []
    seen_platforms = set()
    for platform in platforms:
        platform_name = str(platform).strip()
        if not platform_name:
            continue
        key = platform_name.lower()
        if key in seen_platforms:
            raise ValueError("Chaque plateforme doit être unique.")
        seen_platforms.add(key)
        normalized_platforms.append(platform_name)

    if not normalized_rooms:
        raise ValueError("Au moins une chambre valide est requise.")
    if not normalized_platforms:
        raise ValueError("Au moins une plateforme valide est requise.")
    if DIRECT_BOOKING_PLATFORM.lower() not in {platform.lower() for platform in normalized_platforms}:
        normalized_platforms.append(DIRECT_BOOKING_PLATFORM)

    return {
        "propertyName": property_name,
        "description": description,
        "currency": currency,
        "rooms": normalized_rooms,
        "platforms": normalized_platforms,
        "site": normalize_site_settings(payload.get("site", {})),
        "notifications": normalize_notification_settings(payload.get("notifications", {})),
    }


def validate_reservation(payload: dict, settings: dict, reservations: list[dict]) -> dict:
    booking_type = str(payload.get("bookingType", "reservation")).strip() or "reservation"
    status = str(payload.get("status", "confirmed")).strip() or "confirmed"
    room_id = str(payload.get("roomId", "")).strip()
    arrival_date = str(payload.get("arrivalDate", "")).strip()
    departure_date = str(payload.get("departureDate", "")).strip()
    client_name = str(payload.get("clientName", "")).strip()
    client_contact = str(payload.get("clientContact", "")).strip()
    platform = str(payload.get("platform", "")).strip()
    comment = str(payload.get("comment", "")).strip()
    reservation_id = str(payload.get("id", "")).strip() or uuid.uuid4().hex
    group_id = str(payload.get("groupId", "")).strip() or None
    payload_booking_name = str(payload.get("bookingName", "")).strip()

    if booking_type not in {"reservation", "block"}:
        raise ValueError("Type de réservation invalide.")
    if booking_type == "reservation" and status not in ALLOWED_RESERVATION_STATUSES:
        raise ValueError("Statut de réservation invalide.")
    if room_id not in {room["id"] for room in settings["rooms"]}:
        raise ValueError("La chambre sélectionnée n'existe pas.")
    if booking_type == "reservation":
        if platform not in settings["platforms"]:
            raise ValueError("La plateforme sélectionnée n'existe pas.")
        if not client_name or not client_contact:
            raise ValueError("Les informations client sont requises.")
    else:
        platform = ""
        client_name = ""
        client_contact = ""
        status = "blocked"

    try:
        arrival = datetime.strptime(arrival_date, "%Y-%m-%d")
        departure = datetime.strptime(departure_date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("Dates invalides.") from exc

    if departure <= arrival:
        raise ValueError("La date de départ doit être après la date d'arrivée.")

    amount = float(payload.get("amount", 0))
    if amount < 0:
        raise ValueError("Le montant ne peut pas être négatif.")
    if booking_type == "block":
        amount = 0

    existing_reservation = next(
        (reservation for reservation in reservations if reservation["id"] == reservation_id),
        None,
    )
    booking_name = (
        payload_booking_name
        or (existing_reservation["bookingName"] if existing_reservation else "")
        or get_next_booking_name(reservations, booking_type)
    )

    for reservation in reservations:
        if reservation["roomId"] != room_id or reservation["id"] == reservation_id:
            continue
        if str(reservation.get("status", "")).strip() == "cancelled":
            continue
        existing_arrival = datetime.strptime(reservation["arrivalDate"], "%Y-%m-%d")
        existing_departure = datetime.strptime(reservation["departureDate"], "%Y-%m-%d")
        if periods_overlap(arrival, departure, existing_arrival, existing_departure):
            raise ValueError(
                f'Chevauchement avec la reservation "{reservation["bookingName"]}" pour cette chambre.'
            )

    now = datetime.now().isoformat(timespec="seconds")
    created_at = (
        str(payload.get("createdAt", "")).strip()
        or next(
            (reservation.get("createdAt") for reservation in reservations if reservation["id"] == reservation_id),
            now,
        )
    )
    updated_at = str(payload.get("updatedAt", "")).strip() or now

    return {
        "id": reservation_id,
        "groupId": group_id or (existing_reservation.get("groupId") if existing_reservation else None),
        "bookingType": booking_type,
        "status": status,
        "bookingName": booking_name,
        "roomId": room_id,
        "arrivalDate": arrival_date,
        "departureDate": departure_date,
        "clientName": client_name,
        "clientContact": client_contact,
        "platform": platform,
        "amount": amount,
        "comment": comment,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def build_reservations(payload: dict, settings: dict, reservations: list[dict]) -> list[dict]:
    booking_type = str(payload.get("bookingType", "reservation")).strip() or "reservation"
    room_ids = payload.get("roomIds", [])
    group_id = str(payload.get("groupId", "")).strip() or None
    reservation_id = str(payload.get("id", "")).strip()

    if booking_type == "block" and isinstance(room_ids, list):
        built_reservations = []
        seen_room_ids = set()
        normalized_room_ids = [str(room_id).strip() for room_id in room_ids if str(room_id).strip()]

        if not normalized_room_ids:
            raise ValueError("Sélectionne au moins une chambre à bloquer.")

        working_reservations = reservations
        if group_id:
            working_reservations = [
                reservation for reservation in reservations if str(reservation.get("groupId") or "") != group_id
            ]
        elif reservation_id:
            working_reservations = [reservation for reservation in reservations if reservation["id"] != reservation_id]

        generated_group_id = group_id or (uuid.uuid4().hex if len(normalized_room_ids) > 1 else None)

        if len(normalized_room_ids) == 1 and reservation_id and not group_id:
            cloned_payload = dict(payload)
            cloned_payload["roomId"] = normalized_room_ids[0]
            cloned_payload.pop("roomIds", None)
            return [validate_reservation(cloned_payload, settings, working_reservations)]

        for room_id in normalized_room_ids:
            if room_id in seen_room_ids:
                continue
            seen_room_ids.add(room_id)
            cloned_payload = dict(payload)
            cloned_payload["roomId"] = room_id
            cloned_payload.pop("id", None)
            cloned_payload.pop("roomIds", None)
            if generated_group_id:
                cloned_payload["groupId"] = generated_group_id
            built_reservations.append(
                validate_reservation(cloned_payload, settings, working_reservations + built_reservations)
            )

        if not built_reservations:
            raise ValueError("Sélectionne au moins une chambre à bloquer.")

        return built_reservations

    return [validate_reservation(payload, settings, reservations)]


def rebuild_reservations(reservations: list[dict], settings: dict) -> list[dict]:
    validated_reservations: list[dict] = []
    for reservation in reservations:
        payload = dict(reservation)
        if payload.get("bookingType") == "block":
            payload["roomIds"] = [payload.get("roomId")]
        validated_reservations.extend(build_reservations(payload, settings, validated_reservations))
    validated_reservations.sort(key=lambda item: (item["arrivalDate"], item["createdAt"], item["id"]))
    return validated_reservations


def get_next_booking_name(reservations: list[dict], booking_type: str) -> str:
    highest_number = 0
    label = "Blocage" if booking_type == "block" else "Réservation"
    pattern = (
        re.compile(r"^Blocage\s*n[°o]?\s*(\d+)$", re.IGNORECASE)
        if booking_type == "block"
        else re.compile(r"^(?:Réservation|Reservation)\s*n[°o]?\s*(\d+)$", re.IGNORECASE)
    )
    for reservation in reservations:
        if str(reservation.get("bookingType", "reservation")).strip() != booking_type:
            continue
        match = pattern.match(str(reservation.get("bookingName", "")).strip())
        if match:
            highest_number = max(highest_number, int(match.group(1)))
    return f"{label} n°{highest_number + 1}"


def detect_image_type(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def parse_multipart_file(body: bytes, content_type: str, field_name: str = "file"):
    """Extrait (filename, content_type, data) du champ `field_name` d'un corps
    multipart/form-data, en stdlib pure (remplace cgi.FieldStorage, retiré en Python 3.13)."""
    if "multipart/form-data" not in (content_type or "").lower():
        return None
    prologue = b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n"
    message = BytesParser(policy=policy.default).parsebytes(prologue + body)
    if not message.is_multipart():
        return None
    for part in message.iter_parts():
        disposition = part.get("content-disposition")
        if disposition is None or disposition.params.get("name") != field_name:
            continue
        data = part.get_payload(decode=True) or b""
        return part.get_filename(), part.get_content_type(), data
    return None


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt, digest = encoded.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(hash_password(password, salt), encoded)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(conn: sqlite3.Connection) -> str:
    purge_expired_sessions(conn)
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now() + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
    auth = conn.execute("SELECT session_revision FROM admin_auth WHERE id = 1").fetchone()
    conn.execute(
        "INSERT INTO admin_sessions(token_hash, session_revision, created_at, expires_at) VALUES(?, ?, ?, ?)",
        (hash_session_token(token), auth["session_revision"], datetime.now().isoformat(timespec="seconds"), expires_at),
    )
    return token


def purge_expired_sessions(conn: sqlite3.Connection) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    conn.execute("DELETE FROM admin_sessions WHERE expires_at IS NOT NULL AND expires_at <= ?", (now,))


def is_valid_session(conn: sqlite3.Connection, token: str | None) -> bool:
    if not token:
        return False
    # Lecture seule : l'expiration est filtrée dans le SELECT (plus d'écriture sur chaque GET).
    now = datetime.now().isoformat(timespec="seconds")
    session = conn.execute(
        "SELECT session_revision FROM admin_sessions "
        "WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)",
        (hash_session_token(token), now),
    ).fetchone()
    auth = conn.execute("SELECT session_revision FROM admin_auth WHERE id = 1").fetchone()
    return bool(session and auth and session["session_revision"] == auth["session_revision"])


def delete_session(conn: sqlite3.Connection, token: str | None) -> None:
    if token:
        conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (hash_session_token(token),))


def change_admin_password(conn: sqlite3.Connection, current_password: str, new_password: str) -> None:
    if len(new_password) < 8:
        raise ValueError("Le nouveau mot de passe doit contenir au moins 8 caractères.")
    auth = conn.execute("SELECT password_hash FROM admin_auth WHERE id = 1").fetchone()
    if not auth or not verify_password(current_password, auth["password_hash"]):
        raise ValueError("Mot de passe actuel incorrect.")
    revision = uuid.uuid4().hex
    conn.execute(
        "UPDATE admin_auth SET password_hash = ?, session_revision = ? WHERE id = 1",
        (hash_password(new_password), revision),
    )
    conn.execute("DELETE FROM admin_sessions")


def cookie_value(headers, name: str) -> str | None:
    cookie_header = headers.get("Cookie", "")
    for item in cookie_header.split(";"):
        key, _, value = item.strip().partition("=")
        if key == name:
            return value
    return None


def session_cookie(token: str, clear: bool = False) -> str:
    if clear:
        value = f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    else:
        value = f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax"
    if os.environ.get("GITE_COOKIE_SECURE") == "1":
        value += "; Secure"
    return value


def is_admin_root_path(path: str) -> bool:
    return path in ADMIN_ROOT_PATHS


def public_room_summary(room: dict) -> dict:
    return {
        key: room[key]
        for key in [
            "id",
            "name",
            "color",
            "bookingRequestsEnabled",
            "summary",
            "description",
            "capacity",
            "price",
            "amenities",
            "amenityGroups",
            "bookingLinks",
            "photos",
        ]
    }


def send_booking_notification(request: dict, notifications: dict) -> None:
    recipient = notifications.get("notifyEmail", "")
    host = notifications.get("smtpHost", "")
    user = notifications.get("smtpUser", "")
    password = notifications.get("smtpPassword", "")
    port = int(notifications.get("smtpPort", "587") or 587)
    if not recipient or not host or not user:
        return
    room_name = request.get("roomName", request.get("roomId", ""))
    msg = EmailMessage()
    msg["Subject"] = f"Nouvelle demande de réservation — {room_name}"
    msg["From"] = user
    msg["To"] = recipient
    msg.set_content(
        f"Chambre : {room_name}\n"
        f"Voyageur : {request.get('guestName', '')}\n"
        f"Contact : {request.get('guestContact', '')}\n"
        f"Arrivée : {request.get('arrivalDate', '')}\n"
        f"Départ : {request.get('departureDate', '')}\n"
        f"Voyageurs : {request.get('guestCount', '')}\n"
        f"Message : {request.get('message', '') or '—'}\n"
    )
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port) as smtp:
                smtp.ehlo()
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                smtp.login(user, password)
                smtp.send_message(msg)
        logger.info("Notification email sent to %s", recipient)
    except Exception as exc:
        logger.error("Failed to send notification email: %s", exc)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def route_static_page(self, path: str) -> str:
        if path == "/":
            return "/public.html"
        if is_admin_root_path(path):
            return "/login.html"
        if path == ADMIN_APP_PATH:
            return "/index.html"
        return path

    def redirect_authenticated_admin_root(self, path: str) -> bool:
        if is_admin_root_path(path) and self.is_authenticated():
            self.send_redirect(ADMIN_APP_PATH)
            return True
        return False

    def redirect_unauthenticated_admin_app(self, path: str) -> bool:
        if path == ADMIN_APP_PATH and not self.is_authenticated():
            self.send_redirect(ADMIN_LOGIN_PATH)
            return True
        return False

    def redirect_admin_route(self, path: str) -> bool:
        return self.redirect_authenticated_admin_root(path) or self.redirect_unauthenticated_admin_app(path)

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        if self.redirect_admin_route(parsed.path):
            return
        self.path = self.route_static_page(parsed.path)
        super().do_HEAD()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/session":
            self.send_json({"authenticated": self.is_authenticated()})
            return
        if parsed.path == "/api/public-site":
            ensure_database()
            with get_connection() as conn:
                self.send_json(build_public_site(conn))
            return
        if parsed.path == "/api/availability":
            params = parse_qs(parsed.query)
            try:
                ensure_database()
                with get_connection() as conn:
                    self.send_json(
                        build_availability(
                            conn,
                            params.get("arrivalDate", [""])[0],
                            params.get("departureDate", [""])[0],
                        )
                    )
            except ValueError as exc:
                self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)
            return
        if parsed.path.startswith("/uploads/"):
            self.serve_upload(parsed.path.removeprefix("/uploads/"))
            return
        if parsed.path == "/api/state":
            if not self.require_admin():
                return
            self.send_json(load_state())
            return
        if parsed.path == "/api/backup":
            if not self.require_admin():
                return
            state = load_state()
            self.send_json(
                {
                    "settings": state["settings"],
                    "reservations": state["reservations"],
                    "bookingRequests": state["bookingRequests"],
                    "exportedAt": datetime.now().isoformat(timespec="seconds"),
                }
            )
            return
        if self.redirect_admin_route(parsed.path):
            return
        self.path = self.route_static_page(parsed.path)
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/upload":
            if not self.require_admin():
                return
            self.handle_upload()
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw_payload = self.rfile.read(length) if length else b"{}"

        try:
            payload = json.loads(raw_payload.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error_json("JSON invalide.", HTTPStatus.BAD_REQUEST)
            return

        try:
            if parsed.path == "/api/login":
                client_ip = self.client_address[0]
                now_ts = time.time()
                with _login_lock:
                    _login_attempts[client_ip] = [
                        t for t in _login_attempts[client_ip] if now_ts - t < LOGIN_WINDOW_SECONDS
                    ]
                    attempt_count = len(_login_attempts[client_ip])
                if attempt_count >= LOGIN_MAX_ATTEMPTS:
                    logger.warning("login rate-limited ip=%s attempts=%d", client_ip, attempt_count)
                    self.send_error_json("Trop de tentatives. Réessayez dans 15 minutes.", HTTPStatus.TOO_MANY_REQUESTS)
                    return
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        auth = conn.execute("SELECT password_hash FROM admin_auth WHERE id = 1").fetchone()
                        password = str(payload.get("password", ""))
                        if not auth or not verify_password(password, auth["password_hash"]):
                            with _login_lock:
                                _login_attempts[client_ip].append(now_ts)
                            logger.warning("login failed ip=%s", client_ip)
                            self.send_error_json("Mot de passe incorrect.", HTTPStatus.UNAUTHORIZED)
                            return
                        with _login_lock:
                            _login_attempts.pop(client_ip, None)
                        token = create_session(conn)
                        conn.commit()
                        logger.info("login success ip=%s", client_ip)
                        self.send_json({"authenticated": True}, headers={"Set-Cookie": session_cookie(token)})
                        return

            if parsed.path == "/api/logout":
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        delete_session(conn, self.current_session_token())
                        conn.commit()
                self.send_json({"authenticated": False}, headers={"Set-Cookie": session_cookie("", clear=True)})
                return

            if parsed.path == "/api/booking-requests":
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        settings = fetch_settings(conn)
                        reservations = fetch_reservations(conn)
                        booking_request = validate_booking_request(payload, settings, reservations)
                        insert_booking_request_db(conn, booking_request)
                        bump_version(conn, "booking_requests_revision")
                        conn.commit()
                        notifications = fetch_notification_settings(conn)
                        self.send_json({"bookingRequest": booking_request}, HTTPStatus.CREATED)
                        threading.Thread(
                            target=send_booking_notification,
                            args=(booking_request, notifications),
                            daemon=True,
                        ).start()
                        return

            if not self.require_admin():
                return

            if parsed.path == "/api/admin/password":
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        change_admin_password(
                            conn,
                            str(payload.get("currentPassword", "")),
                            str(payload.get("newPassword", "")),
                        )
                        conn.commit()
                        self.send_json({"authenticated": False}, headers={"Set-Cookie": session_cookie("", clear=True)})
                        return

            if parsed.path.startswith("/api/booking-requests/"):
                parts = parsed.path.strip("/").split("/")
                if len(parts) == 3 and parts[0] == "api" and parts[1] == "booking-requests":
                    request_id = parts[2]
                    action = str(payload.get("action", "")).strip()
                    with DATA_LOCK:
                        ensure_database()
                        with get_connection() as conn:
                            request = fetch_booking_request_by_id(conn, request_id)
                            if not request:
                                self.send_error_json("Demande introuvable.", HTTPStatus.NOT_FOUND)
                                return
                            if action == "reject":
                                cancelled = build_cancelled_reservation_from_request(request)
                                upsert_reservations_db(conn, [cancelled])
                                update_booking_request_status_db(conn, request_id, "rejected")
                                bump_version(conn, "reservations_revision")
                                bump_version(conn, "booking_requests_revision")
                                conn.commit()
                                self.send_json({
                                    "reservations": fetch_reservations(conn),
                                    "bookingRequests": fetch_booking_requests(conn),
                                    "versions": get_versions(conn),
                                })
                                return
                            if action == "accept":
                                settings = fetch_settings(conn)
                                reservations = fetch_reservations(conn)
                                reservation_payload = build_reservation_payload_from_request(request, payload, settings)
                                if not is_room_available(
                                    reservation_payload["roomId"],
                                    reservation_payload["arrivalDate"],
                                    reservation_payload["departureDate"],
                                    reservations,
                                ):
                                    raise ValueError("Cette chambre n'est plus disponible pour ces dates.")
                                new_reservations = build_reservations(reservation_payload, settings, reservations)
                                upsert_reservations_db(conn, new_reservations)
                                update_booking_request_status_db(conn, request_id, "accepted")
                                bump_version(conn, "reservations_revision")
                                bump_version(conn, "booking_requests_revision")
                                conn.commit()
                                self.send_json(
                                    {
                                        "reservations": fetch_reservations(conn),
                                        "bookingRequests": fetch_booking_requests(conn),
                                        "versions": get_versions(conn),
                                    }
                                )
                                return

            if parsed.path == "/api/settings":
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        state = {
                            "settings": fetch_settings(conn),
                            "reservations": fetch_reservations(conn),
                            "versions": get_versions(conn),
                        }
                        assert_expected_versions(payload, state["versions"])
                        settings = validate_settings(payload)
                        used_room_ids = {reservation["roomId"] for reservation in state["reservations"]}
                        if not used_room_ids.issubset({room["id"] for room in settings["rooms"]}):
                            raise ValueError("Une ou plusieurs réservations pointent vers une chambre supprimée.")
                        used_platforms = {
                            reservation["platform"]
                            for reservation in state["reservations"]
                            if str(reservation.get("bookingType", "reservation")).strip() == "reservation"
                            and str(reservation.get("platform", "")).strip()
                        }
                        if not used_platforms.issubset(set(settings["platforms"])):
                            raise ValueError("Une ou plusieurs réservations utilisent une plateforme supprimée.")
                        write_settings_db(conn, settings)
                        bump_version(conn, "settings_revision")
                        conn.commit()
                        self.send_json({
                            "settings": redact_settings_for_client(fetch_settings(conn)),
                            "versions": get_versions(conn),
                        })
                        return

            if parsed.path == "/api/restore":
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        settings = validate_settings(payload.get("settings", {}))
                        reservations = rebuild_reservations(
                            normalize_reservations(payload.get("reservations", [])),
                            settings,
                        )
                        write_settings_db(conn, settings)
                        write_reservations_db(conn, reservations)
                        bump_version(conn, "settings_revision")
                        bump_version(conn, "reservations_revision")
                        conn.commit()
                        self.send_json(
                            {
                                "settings": redact_settings_for_client(fetch_settings(conn)),
                                "reservations": reservations,
                                "bookingRequests": fetch_booking_requests(conn),
                                "versions": get_versions(conn),
                            }
                        )
                        return

            if parsed.path == "/api/reservations":
                with DATA_LOCK:
                    ensure_database()
                    with get_connection() as conn:
                        state = {
                            "settings": fetch_settings(conn),
                            "reservations": fetch_reservations(conn),
                            "versions": get_versions(conn),
                        }
                        assert_expected_versions(payload, state["versions"])
                        reservations = state["reservations"]
                        new_reservations = build_reservations(payload, state["settings"], reservations)
                        payload_group_id = str(payload.get("groupId", "")).strip()
                        payload_id = str(payload.get("id", "")).strip()
                        if payload_group_id:
                            delete_reservations_by_group_db(conn, payload_group_id)
                        elif payload_id:
                            delete_reservation_db(conn, payload_id)
                        upsert_reservations_db(conn, new_reservations)
                        bump_version(conn, "reservations_revision")
                        conn.commit()
                        updated = fetch_reservations(conn)
                        self.send_json({"reservations": updated, "versions": get_versions(conn)})
                        return
        except ConflictError as exc:
            self.send_error_json(str(exc), HTTPStatus.CONFLICT)
            return
        except ValueError as exc:
            self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)
            return

        self.send_error_json("Route introuvable.", HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        prefix = "/api/reservations/"
        if not parsed.path.startswith(prefix):
            self.send_error_json("Route introuvable.", HTTPStatus.NOT_FOUND)
            return
        if not self.require_admin():
            return

        reservation_id = parsed.path.removeprefix(prefix)
        with DATA_LOCK:
            ensure_database()
            with get_connection() as conn:
                state = {
                    "settings": fetch_settings(conn),
                    "reservations": fetch_reservations(conn),
                    "versions": get_versions(conn),
                }
                assert_expected_versions({"_versions": get_versions_from_headers(self.headers)}, state["versions"])
                reservation = next(
                    (item for item in state["reservations"] if item["id"] == reservation_id),
                    None,
                )
                if reservation and reservation.get("groupId"):
                    delete_reservations_by_group_db(conn, str(reservation["groupId"]))
                elif reservation:
                    delete_reservation_db(conn, reservation_id)
                bump_version(conn, "reservations_revision")
                conn.commit()
                updated = fetch_reservations(conn)
                self.send_json({"reservations": updated, "versions": get_versions(conn)})

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
        path = getattr(self, "path", "") or ""
        if path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        elif path.startswith("/uploads/"):
            # Noms de fichiers = uuid → contenu immuable, cache agressif sûr.
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK, headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def send_redirect(self, location: str, status: HTTPStatus = HTTPStatus.FOUND) -> None:
        self.send_response(status)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_error_json(self, message: str, status: HTTPStatus) -> None:
        self.send_json({"error": message}, status=status)

    def log_message(self, format: str, *args) -> None:
        logger.debug("%s - %s", self.address_string(), format % args)

    def current_session_token(self) -> str | None:
        return cookie_value(self.headers, SESSION_COOKIE_NAME)

    def is_authenticated(self) -> bool:
        ensure_database()
        with get_connection() as conn:
            return is_valid_session(conn, self.current_session_token())

    def require_admin(self) -> bool:
        if self.is_authenticated():
            return True
        self.send_error_json("Authentification requise.", HTTPStatus.UNAUTHORIZED)
        return False

    def handle_upload(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            self.send_error_json("Fichier manquant.", HTTPStatus.BAD_REQUEST)
            return
        if content_length > MAX_UPLOAD_SIZE:
            self.send_error_json("Image trop lourde.", HTTPStatus.BAD_REQUEST)
            return
        body = self.rfile.read(content_length)
        parsed = parse_multipart_file(body, self.headers.get("Content-Type", ""), "file")
        if parsed is None:
            self.send_error_json("Fichier manquant.", HTTPStatus.BAD_REQUEST)
            return
        _filename, content_type, file_data = parsed
        extension = ALLOWED_IMAGE_TYPES.get(content_type)
        if not extension or not file_data:
            self.send_error_json("Format d'image non supporté.", HTTPStatus.BAD_REQUEST)
            return
        if detect_image_type(file_data) != content_type:
            self.send_error_json("Format d'image non supporté.", HTTPStatus.BAD_REQUEST)
            return
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4().hex}{extension}"
        target = UPLOADS_DIR / filename
        target.write_bytes(file_data)
        self.send_json({"url": f"/uploads/{filename}"}, HTTPStatus.CREATED)

    def serve_upload(self, filename: str) -> None:
        safe_name = Path(filename).name
        target = UPLOADS_DIR / safe_name
        if not target.exists() or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }.get(target.suffix.lower(), "application/octet-stream")
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    ensure_database()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    local_url = f"http://127.0.0.1:{PORT}"
    lan_url = get_lan_url(PORT)
    print(f"Serveur actif en local sur {local_url}")
    if lan_url:
        print(f"Accessible sur le réseau local via {lan_url}")
    else:
        print("Adresse réseau local non détectée automatiquement.")
    if os.environ.get("GITE_OPEN_BROWSER", "0") == "1":
        try:
            webbrowser.open(local_url)
        except Exception:
            pass
    if not sys.stdin.isatty():
        server.serve_forever()
        return

    print("Tapez 'exit' puis Entrée pour arrêter le serveur.")
    server_thread = threading.Thread(target=server.serve_forever, name="gite-http-server")
    server_thread.start()
    try:
        while True:
            try:
                command = input().strip().lower()
            except EOFError:
                break
            if command == "exit":
                print("Arrêt du serveur...")
                break
            if command:
                print("Commande inconnue. Tapez 'exit' pour arrêter le serveur.")
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join()


def get_lan_url(port: int) -> str | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        local_ip = sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()

    if not local_ip or local_ip.startswith("127."):
        return None
    return f"http://{local_ip}:{port}"


class ConflictError(ValueError):
    pass


if __name__ == "__main__":
    main()
