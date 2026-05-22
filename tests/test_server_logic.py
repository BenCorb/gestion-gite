import sqlite3
import unittest
import uuid

from server import (
    DEFAULT_SETTINGS,
    build_reservations,
    delete_reservation_db,
    delete_reservations_by_group_db,
    fetch_reservations,
    fetch_settings,
    insert_booking_request_db,
    is_room_available,
    initialize_meta,
    rebuild_reservations,
    sync_platforms_db,
    sync_rooms_db,
    validate_booking_request,
    upsert_settings_db,
    upsert_reservations_db,
    validate_reservation,
    validate_settings,
)


def make_settings():
    return validate_settings(DEFAULT_SETTINGS)


def make_reservation(
    room_id="chambre-1",
    arrival="2026-05-10",
    departure="2026-05-12",
    status="confirmed",
    booking_type="reservation",
    group_id=None,
):
    reservation_id = uuid.uuid4().hex
    payload = {
        "id": reservation_id,
        "groupId": group_id,
        "bookingType": booking_type,
        "status": status,
        "roomId": room_id,
        "arrivalDate": arrival,
        "departureDate": departure,
        "clientName": "" if booking_type == "block" else "Client Test",
        "clientContact": "" if booking_type == "block" else "client@example.com",
        "platform": "" if booking_type == "block" else "Airbnb",
        "amount": 120 if booking_type == "reservation" else 0,
        "comment": "",
    }
    return validate_reservation(payload, make_settings(), [])


class ValidateReservationTests(unittest.TestCase):
    def test_rejects_overlap_with_active_reservation(self):
        existing = [make_reservation(arrival="2026-05-10", departure="2026-05-14")]
        payload = {
            "bookingType": "reservation",
            "status": "confirmed",
            "roomId": "chambre-1",
            "arrivalDate": "2026-05-12",
            "departureDate": "2026-05-15",
            "clientName": "Autre client",
            "clientContact": "autre@example.com",
            "platform": "Airbnb",
            "amount": 90,
            "comment": "",
        }

        with self.assertRaisesRegex(ValueError, "Chevauchement"):
            validate_reservation(payload, make_settings(), existing)

    def test_allows_overlap_with_cancelled_reservation(self):
        existing = [
            make_reservation(arrival="2026-05-10", departure="2026-05-14", status="cancelled")
        ]
        payload = {
            "bookingType": "reservation",
            "status": "confirmed",
            "roomId": "chambre-1",
            "arrivalDate": "2026-05-12",
            "departureDate": "2026-05-15",
            "clientName": "Autre client",
            "clientContact": "autre@example.com",
            "platform": "Airbnb",
            "amount": 90,
            "comment": "",
        }

        reservation = validate_reservation(payload, make_settings(), existing)

        self.assertEqual(reservation["status"], "confirmed")
        self.assertEqual(reservation["roomId"], "chambre-1")


class PublicBookingRequestTests(unittest.TestCase):
    def test_room_availability_uses_active_reservations_and_blocks(self):
        reservations = [
            make_reservation(arrival="2026-05-10", departure="2026-05-12"),
            make_reservation(room_id="chambre-2", arrival="2026-05-11", departure="2026-05-13", booking_type="block"),
            make_reservation(room_id="chambre-3", arrival="2026-05-11", departure="2026-05-13", status="cancelled"),
        ]

        self.assertFalse(is_room_available("chambre-1", "2026-05-11", "2026-05-12", reservations))
        self.assertFalse(is_room_available("chambre-2", "2026-05-11", "2026-05-12", reservations))
        self.assertTrue(is_room_available("chambre-3", "2026-05-11", "2026-05-12", reservations))

    def test_validate_booking_request_rejects_unavailable_room(self):
        existing = [make_reservation(arrival="2026-06-01", departure="2026-06-03")]
        payload = {
            "roomId": "chambre-1",
            "arrivalDate": "2026-06-02",
            "departureDate": "2026-06-04",
            "guestName": "Client Web",
            "guestContact": "client@example.com",
            "guestCount": 2,
        }

        with self.assertRaisesRegex(ValueError, "plus disponible"):
            validate_booking_request(payload, make_settings(), existing)

    def test_validate_booking_request_creates_new_request_for_available_room(self):
        payload = {
            "roomId": "chambre-1",
            "arrivalDate": "2026-06-10",
            "departureDate": "2026-06-12",
            "guestName": "Client Web",
            "guestContact": "client@example.com",
            "guestCount": 2,
            "message": "Bonjour",
        }

        request = validate_booking_request(payload, make_settings(), [])

        self.assertEqual(request["status"], "new")
        self.assertEqual(request["roomId"], "chambre-1")


class BuildReservationsTests(unittest.TestCase):
    def test_build_block_for_multiple_rooms_shares_group_id(self):
        payload = {
            "bookingType": "block",
            "status": "blocked",
            "roomIds": ["chambre-1", "chambre-2"],
            "arrivalDate": "2026-06-01",
            "departureDate": "2026-06-03",
            "comment": "Maintenance",
        }

        reservations = build_reservations(payload, make_settings(), [])

        self.assertEqual(len(reservations), 2)
        self.assertTrue(all(item["bookingType"] == "block" for item in reservations))
        self.assertTrue(all(item["status"] == "blocked" for item in reservations))
        self.assertEqual({item["roomId"] for item in reservations}, {"chambre-1", "chambre-2"})
        self.assertEqual(len({item["groupId"] for item in reservations}), 1)

    def test_rebuild_reservations_sorts_by_arrival_then_creation(self):
        reservations = [
            make_reservation(room_id="chambre-2", arrival="2026-07-12", departure="2026-07-14"),
            make_reservation(room_id="chambre-1", arrival="2026-07-01", departure="2026-07-03"),
        ]

        rebuilt = rebuild_reservations(reservations, make_settings())

        self.assertEqual(
            [item["arrivalDate"] for item in rebuilt],
            ["2026-07-01", "2026-07-12"],
        )


class ReservationPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE reservations (
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
        initialize_meta(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_upsert_updates_existing_reservation_without_rewriting_all_rows(self):
        reservation = make_reservation(arrival="2026-08-01", departure="2026-08-03")
        upsert_reservations_db(self.conn, [reservation])

        updated = dict(reservation)
        updated["status"] = "paid"
        updated["comment"] = "Encaissement reçu"
        upsert_reservations_db(self.conn, [updated])

        stored = fetch_reservations(self.conn)

        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["status"], "paid")
        self.assertEqual(stored[0]["comment"], "Encaissement reçu")

    def test_delete_group_removes_only_target_group(self):
        group_id = uuid.uuid4().hex
        block_payload = {
            "bookingType": "block",
            "status": "blocked",
            "roomIds": ["chambre-1", "chambre-2"],
            "arrivalDate": "2026-09-01",
            "departureDate": "2026-09-03",
            "comment": "Maintenance",
            "groupId": group_id,
        }
        grouped_reservations = build_reservations(block_payload, make_settings(), [])
        standalone = make_reservation(room_id="chambre-3", arrival="2026-09-05", departure="2026-09-07")

        upsert_reservations_db(self.conn, grouped_reservations + [standalone])
        delete_reservations_by_group_db(self.conn, group_id)

        stored = fetch_reservations(self.conn)

        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["id"], standalone["id"])

    def test_delete_single_reservation_keeps_other_rows(self):
        first = make_reservation(room_id="chambre-1", arrival="2026-10-01", departure="2026-10-03")
        second = make_reservation(room_id="chambre-2", arrival="2026-10-04", departure="2026-10-06")

        upsert_reservations_db(self.conn, [first, second])
        delete_reservation_db(self.conn, first["id"])

        stored = fetch_reservations(self.conn)

        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["id"], second["id"])


class SettingsPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                property_name TEXT NOT NULL,
                description TEXT NOT NULL,
                currency TEXT NOT NULL
            );
            CREATE TABLE rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                public_visible INTEGER NOT NULL DEFAULT 1,
                summary TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                capacity INTEGER NOT NULL DEFAULT 2,
                price TEXT NOT NULL DEFAULT '',
                amenities TEXT NOT NULL DEFAULT '[]',
                sort_order INTEGER NOT NULL
            );
            CREATE TABLE room_photos (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                url TEXT NOT NULL,
                alt TEXT NOT NULL,
                sort_order INTEGER NOT NULL
            );
            CREATE TABLE site_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE platforms (
                name TEXT PRIMARY KEY,
                sort_order INTEGER NOT NULL
            );
            """
        )
        initialize_meta(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_upsert_settings_updates_single_settings_row(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)

        updated = dict(settings)
        updated["propertyName"] = "Maison Test"
        updated["currency"] = "USD"
        upsert_settings_db(self.conn, updated)

        stored = self.conn.execute("SELECT property_name, currency FROM settings").fetchall()

        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["property_name"], "Maison Test")
        self.assertEqual(stored[0]["currency"], "USD")

    def test_sync_rooms_replaces_removed_rows_and_updates_order(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)
        sync_rooms_db(self.conn, settings["rooms"])

        updated_rooms = [
            {"id": "chambre-2", "name": "Suite Jardin", "color": "#e6c28b"},
            {"id": "chambre-4", "name": "Loft", "color": "#95c8c0"},
        ]
        sync_rooms_db(self.conn, updated_rooms)

        stored = fetch_settings(self.conn)

        self.assertEqual([room["id"] for room in stored["rooms"]], ["chambre-2", "chambre-4"])
        self.assertEqual(stored["rooms"][0]["name"], "Suite Jardin")

    def test_sync_platforms_removes_missing_entries(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)
        sync_platforms_db(self.conn, settings["platforms"])
        sync_platforms_db(self.conn, ["Booking", "Site direct"])

        stored = fetch_settings(self.conn)

        self.assertEqual(stored["platforms"], ["Booking", "Site direct"])


if __name__ == "__main__":
    unittest.main()
