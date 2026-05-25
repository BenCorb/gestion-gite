import sqlite3
import unittest
import uuid
from http import HTTPStatus

from server import (
    ADMIN_APP_PATH,
    AppHandler,
    DEFAULT_SETTINGS,
    DIRECT_BOOKING_PLATFORM,
    build_reservation_payload_from_request,
    build_reservations,
    delete_reservation_db,
    delete_reservations_by_group_db,
    fetch_reservations,
    fetch_settings,
    insert_booking_request_db,
    is_admin_root_path,
    is_room_available,
    initialize_meta,
    normalize_amenity_groups,
    rebuild_reservations,
    sync_platforms_db,
    sync_rooms_db,
    sync_site_settings_db,
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


class AdminRoutingTests(unittest.TestCase):
    def make_handler(self, authenticated: bool):
        handler = object.__new__(AppHandler)
        handler.is_authenticated = lambda: authenticated
        handler.redirects = []

        def send_redirect(location: str, status: HTTPStatus = HTTPStatus.FOUND) -> None:
            handler.redirects.append((location, status))

        handler.send_redirect = send_redirect
        return handler

    def test_admin_roots_are_identified(self):
        self.assertTrue(is_admin_root_path("/gestion"))
        self.assertTrue(is_admin_root_path("/gestion/"))
        self.assertFalse(is_admin_root_path(ADMIN_APP_PATH))

    def test_authenticated_admin_root_redirects_to_app(self):
        for path in ("/gestion", "/gestion/"):
            with self.subTest(path=path):
                handler = self.make_handler(authenticated=True)

                redirected = handler.redirect_authenticated_admin_root(path)

                self.assertTrue(redirected)
                self.assertEqual(handler.redirects, [(ADMIN_APP_PATH, HTTPStatus.FOUND)])

    def test_unauthenticated_admin_root_serves_login(self):
        handler = self.make_handler(authenticated=False)

        self.assertFalse(handler.redirect_authenticated_admin_root("/gestion/"))
        self.assertEqual(handler.route_static_page("/gestion/"), "/login.html")

    def test_admin_app_does_not_redirect_to_itself(self):
        handler = self.make_handler(authenticated=True)

        self.assertFalse(handler.redirect_authenticated_admin_root(ADMIN_APP_PATH))
        self.assertEqual(handler.route_static_page(ADMIN_APP_PATH), "/index.html")


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

    def test_build_reservation_payload_from_request_uses_edits_and_direct_platform(self):
        request = {
            "roomId": "chambre-1",
            "arrivalDate": "2026-07-01",
            "departureDate": "2026-07-03",
            "guestName": "Client Web",
            "guestContact": "client@example.com",
            "message": "Message initial",
        }
        payload = {
            "reservation": {
                "roomId": "chambre-2",
                "arrivalDate": "2026-07-05",
                "departureDate": "2026-07-08",
                "clientName": "Client modifié",
                "clientContact": "client-modifie@example.com",
                "amount": 250,
                "comment": "Commentaire admin",
            }
        }

        reservation_payload = build_reservation_payload_from_request(request, payload, make_settings())

        self.assertEqual(reservation_payload["roomId"], "chambre-2")
        self.assertEqual(reservation_payload["clientName"], "Client modifié")
        self.assertEqual(reservation_payload["platform"], DIRECT_BOOKING_PLATFORM)
        self.assertEqual(reservation_payload["amount"], 250)

    def test_legacy_amenities_are_migrated_to_default_group(self):
        groups = normalize_amenity_groups(None, ["Wifi", "Serviettes"])

        self.assertEqual(groups, [{"name": "Équipements", "items": ["Wifi", "Serviettes"]}])


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
                amenity_groups TEXT NOT NULL DEFAULT '[]',
                booking_links TEXT NOT NULL DEFAULT '[]',
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
            CREATE TABLE notification_settings (
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
        updated["propertyName"] = "Le Clos Test"
        updated["currency"] = "USD"
        upsert_settings_db(self.conn, updated)

        stored = self.conn.execute("SELECT property_name, currency FROM settings").fetchall()

        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["property_name"], "Le Clos Test")
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

    def test_sync_rooms_persists_booking_links(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)
        updated_rooms = [
            {
                **settings["rooms"][0],
                "bookingLinks": [
                    {"label": "Airbnb", "url": "https://airbnb.example/chambre-1"},
                    {"label": "Booking", "url": "https://booking.example/chambre-1"},
                ],
            }
        ]

        sync_rooms_db(self.conn, updated_rooms)

        stored = fetch_settings(self.conn)

        self.assertEqual(stored["rooms"][0]["bookingLinks"][0]["label"], "Airbnb")
        self.assertEqual(stored["rooms"][0]["bookingLinks"][1]["url"], "https://booking.example/chambre-1")

    def test_sync_rooms_persists_amenity_groups(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)
        updated_rooms = [
            {
                **settings["rooms"][0],
                "amenityGroups": [
                    {"name": "Salle de bain", "items": ["Douche", "Serviettes"]},
                    {"name": "Confort", "items": ["Wifi"]},
                ],
            }
        ]

        sync_rooms_db(self.conn, updated_rooms)

        stored = fetch_settings(self.conn)

        self.assertEqual(stored["rooms"][0]["amenityGroups"][0]["name"], "Salle de bain")
        self.assertEqual(stored["rooms"][0]["amenityGroups"][1]["items"], ["Wifi"])

    def test_sync_platforms_removes_missing_entries(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)
        sync_platforms_db(self.conn, settings["platforms"])
        sync_platforms_db(self.conn, ["Booking", "Site direct"])

        stored = fetch_settings(self.conn)

        self.assertEqual(stored["platforms"], ["Booking", "Site direct", DIRECT_BOOKING_PLATFORM])

    def test_sync_site_settings_persists_gite_section(self):
        settings = make_settings()
        upsert_settings_db(self.conn, settings)
        sync_rooms_db(self.conn, settings["rooms"])
        sync_platforms_db(self.conn, settings["platforms"])
        sync_site_settings_db(
            self.conn,
            {
                "giteTitle": "La maison",
                "giteDescription": "Un grand jardin et une terrasse.",
                "gitePhotos": [{"url": "/uploads/gite.jpg", "alt": "Terrasse"}],
            },
        )

        stored = fetch_settings(self.conn)

        self.assertEqual(stored["site"]["giteTitle"], "La maison")
        self.assertEqual(stored["site"]["giteDescription"], "Un grand jardin et une terrasse.")
        self.assertEqual(stored["site"]["gitePhotos"], [{"url": "/uploads/gite.jpg", "alt": "Terrasse"}])


if __name__ == "__main__":
    unittest.main()
