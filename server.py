from __future__ import annotations

import json
import re
import socket
import sqlite3
import threading
import uuid
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_FILE = DATA_DIR / "reservations.sqlite3"
SETTINGS_FILE = DATA_DIR / "settings.json"
RESERVATIONS_FILE = DATA_DIR / "reservations.json"
HOST = "0.0.0.0"
PORT = 8000


DEFAULT_SETTINGS = {
    "propertyName": "Mon gîte",
    "description": "",
    "currency": "EUR",
    "rooms": [
        {"id": "chambre-1", "name": "Chambre 1", "color": "#98c7a3"},
        {"id": "chambre-2", "name": "Chambre 2", "color": "#e6c28b"},
        {"id": "chambre-3", "name": "Chambre 3", "color": "#9dbdd7"},
    ],
    "platforms": ["Airbnb", "Booking", "GreenGo"],
}

DEFAULT_RESERVATIONS = {"reservations": []}
DEFAULT_ROOM_COLORS = ["#98c7a3", "#e6c28b", "#9dbdd7", "#d8a7a7", "#b8abd8", "#95c8c0"]
ALLOWED_RESERVATION_STATUSES = {"pending", "confirmed", "paid", "cancelled"}
DATA_LOCK = threading.RLock()


def ensure_database() -> None:
    DATA_DIR.mkdir(exist_ok=True)
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
                sort_order INTEGER NOT NULL
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
            """
        )
        initialize_meta(conn)
        settings_count = conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]
        if settings_count == 0:
            import_initial_data(conn)
        conn.commit()


def initialize_meta(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)",
        [
            ("settings_revision", "1"),
            ("reservations_revision", "1"),
        ],
    )


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def import_initial_data(conn: sqlite3.Connection) -> None:
    legacy_settings, legacy_reservations = read_legacy_json_data()
    settings = validate_settings(legacy_settings)
    reservations = rebuild_reservations(
        normalize_reservations(legacy_reservations),
        settings,
    )
    write_settings_db(conn, settings)
    write_reservations_db(conn, reservations)


def read_legacy_json_data() -> tuple[dict, list[dict]]:
    if SETTINGS_FILE.exists():
        try:
            settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            reservations = []
            if RESERVATIONS_FILE.exists():
                reservations_payload = json.loads(RESERVATIONS_FILE.read_text(encoding="utf-8"))
                reservations = reservations_payload.get("reservations", [])
            return normalize_settings(settings), reservations
        except (json.JSONDecodeError, OSError, ValueError):
            pass

    return DEFAULT_SETTINGS, DEFAULT_RESERVATIONS["reservations"]


def load_state() -> dict:
    ensure_database()
    with get_connection() as conn:
        return {
            "settings": fetch_settings(conn),
            "reservations": fetch_reservations(conn),
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
    }


def normalize_settings(settings: dict) -> dict:
    merged = {
        "propertyName": settings.get("propertyName", DEFAULT_SETTINGS["propertyName"]),
        "description": settings.get("description", DEFAULT_SETTINGS["description"]),
        "currency": settings.get("currency", DEFAULT_SETTINGS["currency"]),
        "platforms": settings.get("platforms", DEFAULT_SETTINGS["platforms"]),
        "rooms": [],
    }
    for index, room in enumerate(settings.get("rooms", DEFAULT_SETTINGS["rooms"])):
        merged["rooms"].append(
            {
                "id": room.get("id", f"room-{index + 1}"),
                "name": room.get("name", f"Chambre {index + 1}"),
                "color": room.get("color") or DEFAULT_ROOM_COLORS[index % len(DEFAULT_ROOM_COLORS)],
            }
        )
    return merged


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
        "SELECT id, name, color FROM rooms ORDER BY sort_order, name"
    ).fetchall()
    platforms = conn.execute(
        "SELECT name FROM platforms ORDER BY sort_order, name"
    ).fetchall()
    return normalize_settings(
        {
            "propertyName": base["property_name"],
            "description": base["description"],
            "currency": base["currency"],
            "rooms": [dict(room) for room in rooms],
            "platforms": [row["name"] for row in platforms],
        }
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


def write_settings_db(conn: sqlite3.Connection, settings: dict) -> None:
    conn.execute("DELETE FROM settings")
    conn.execute(
        """
        INSERT INTO settings(id, property_name, description, currency)
        VALUES(1, ?, ?, ?)
        """,
        (
            settings["propertyName"],
            settings["description"],
            settings["currency"],
        ),
    )
    conn.execute("DELETE FROM rooms")
    conn.executemany(
        "INSERT INTO rooms(id, name, color, sort_order) VALUES(?, ?, ?, ?)",
        [
            (room["id"], room["name"], room["color"], index)
            for index, room in enumerate(settings["rooms"])
        ],
    )
    conn.execute("DELETE FROM platforms")
    conn.executemany(
        "INSERT INTO platforms(name, sort_order) VALUES(?, ?)",
        [(platform, index) for index, platform in enumerate(settings["platforms"])],
    )


def write_reservations_db(conn: sqlite3.Connection, reservations: list[dict]) -> None:
    conn.execute("DELETE FROM reservations")
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
        """,
        [
            (
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
            for reservation in reservations
        ],
    )


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
        normalized_rooms.append({"id": room_id, "name": room_name, "color": room_color})

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

    return {
        "propertyName": property_name,
        "description": description,
        "currency": currency,
        "rooms": normalized_rooms,
        "platforms": normalized_platforms,
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
        if arrival < existing_departure and departure > existing_arrival:
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


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.send_json(load_state())
            return
        if parsed.path == "/api/backup":
            state = load_state()
            self.send_json(
                {
                    "settings": state["settings"],
                    "reservations": state["reservations"],
                    "exportedAt": datetime.now().isoformat(timespec="seconds"),
                }
            )
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        raw_payload = self.rfile.read(length) if length else b"{}"

        try:
            payload = json.loads(raw_payload.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error_json("JSON invalide.", HTTPStatus.BAD_REQUEST)
            return

        try:
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
                        self.send_json({"settings": settings, "versions": get_versions(conn)})
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
                                "settings": settings,
                                "reservations": reservations,
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
                        updated = reservations
                        if payload_group_id:
                            updated = [
                                item for item in updated if str(item.get("groupId") or "") != payload_group_id
                            ]
                        elif payload_id:
                            updated = [item for item in updated if item["id"] != payload_id]
                        updated.extend(new_reservations)
                        updated.sort(key=lambda item: (item["arrivalDate"], item["createdAt"], item["id"]))
                        write_reservations_db(conn, updated)
                        bump_version(conn, "reservations_revision")
                        conn.commit()
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
                if reservation is None:
                    updated = state["reservations"]
                elif reservation.get("groupId"):
                    updated = [
                        item
                        for item in state["reservations"]
                        if str(item.get("groupId") or "") != str(reservation["groupId"])
                    ]
                else:
                    updated = [item for item in state["reservations"] if item["id"] != reservation_id]
                write_reservations_db(conn, updated)
                bump_version(conn, "reservations_revision")
                conn.commit()
                self.send_json({"reservations": updated, "versions": get_versions(conn)})

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message: str, status: HTTPStatus) -> None:
        self.send_json({"error": message}, status=status)

    def log_message(self, format: str, *args) -> None:
        return


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
    try:
        webbrowser.open(local_url)
    except Exception:
        pass
    server.serve_forever()


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
