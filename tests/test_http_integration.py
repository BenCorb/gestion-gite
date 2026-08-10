"""Tests d'intégration HTTP : lancent un vrai serveur AppHandler en thread,
contre une base et un dossier d'uploads temporaires. Couvrent les comportements
ajoutés/modifiés par l'audit : rate-limit login, session en lecture seule,
disponibilité, flux de demande, upload multipart (parseur stdlib), cascade de
suppression de chambre + GC des uploads, et masquage du secret SMTP.

Note : on monkeypatch le module `gite.app` (et non la façade `server`), car les
fonctions y lisent leurs globales (`DB_FILE`, `UPLOADS_DIR`, ...) et les noms en
underscore ne sont pas ré-exportés par `from gite.app import *`."""

import base64
import http.client
import json
import os
import pathlib
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

from gite import app as srv

# PNG 1×1 valide (magic bytes corrects pour detect_image_type).
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


class HttpIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._orig_db = srv.DB_FILE
        self._orig_uploads = srv.UPLOADS_DIR
        srv.DB_FILE = pathlib.Path(self.tmp) / "test.sqlite3"
        srv.UPLOADS_DIR = pathlib.Path(self.tmp) / "uploads"
        srv._DB_READY = False
        srv._login_attempts.clear()
        os.environ["ADMIN_INITIAL_PASSWORD"] = "test1234"
        srv.ensure_database()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.AppHandler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        srv.DB_FILE = self._orig_db
        srv.UPLOADS_DIR = self._orig_uploads
        srv._DB_READY = False
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ── helpers ──────────────────────────────────────────────────────────
    def request(self, method, path, body=None, headers=None, cookie=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        hdrs = dict(headers or {})
        if cookie:
            hdrs["Cookie"] = cookie
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=body, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            payload = raw
        return resp.status, dict(resp.getheaders()), payload

    def login(self, password="test1234"):
        status, headers, _ = self.request("POST", "/api/login", {"password": password})
        self.assertEqual(status, 200, "login devrait réussir")
        return headers["Set-Cookie"].split(";")[0]

    def _multipart(self, data, content_type, field="file", filename="x.png"):
        boundary = "----giteTestBoundary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        return body, headers

    def configure_published_example(self):
        with srv.get_connection() as conn:
            settings = srv.fetch_settings(conn)
            settings["propertyName"] = "Maison des Érables"
            settings["site"].update(
                {
                    "headline": "Maison des Érables",
                    "subtitle": "Belle-Rive, France",
                    "intro": "Bienvenue dans notre longère charentaise à 18 minutes de Cognac.",
                    "giteTitle": "Maison des Érables",
                    "giteDescription": "Notre vieille longère charentaise a une âme.",
                    "addressDetails": {
                        "streetAddress": "12 chemin des Érables",
                        "postalCode": "12345",
                        "addressLocality": "Belle-Rive",
                        "addressRegion": "Pays de la Loire",
                        "addressCountry": "FR",
                    },
                    "seo": {
                        "publicUrl": "https://maison-des-erables.example/",
                        "published": True,
                        "titleOverride": "",
                        "descriptionOverride": "",
                    },
                }
            )
            for room, name in zip(settings["rooms"], ["Églantine", "Horizon", "Verger"]):
                room["name"] = name
                room["description"] = f"Présentation de la chambre {name}."
            settings = srv.validate_settings(settings)
            srv.write_settings_db(conn, settings)
            srv.bump_version(conn, "settings_revision")
            conn.commit()

    # ── tests ────────────────────────────────────────────────────────────
    def test_unpublished_home_is_server_rendered_but_noindex(self):
        status, headers, body = self.request("GET", "/")
        html = body.decode("utf-8")

        self.assertEqual(status, 200)
        self.assertEqual(headers.get("X-Robots-Tag"), "noindex, follow")
        self.assertIn('<meta name="robots" content="noindex, follow"', html)
        self.assertIn("Bienvenue dans notre gîte", html)
        self.assertIn('id="public-site-data"', html)

    def test_published_home_head_redirect_robots_and_sitemap(self):
        self.configure_published_example()

        status, headers, body = self.request("GET", "/")
        html = body.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertNotIn("X-Robots-Tag", headers)
        self.assertIn("Chambres d’hôtes à Belle-Rive | Maison des Érables", html)
        for expected in ["Cognac", "Églantine", "Horizon", "Verger", "vieille longère"]:
            self.assertIn(expected, html)
        self.assertIn('<link rel="canonical" href="https://maison-des-erables.example/"', html)
        self.assertIn('"@type":"BedAndBreakfast"', html)

        head_status, head_headers, head_body = self.request("HEAD", "/")
        self.assertEqual(head_status, 200)
        self.assertEqual(head_body, b"")
        self.assertEqual(head_headers["Content-Length"], headers["Content-Length"])

        redirect_status, redirect_headers, _ = self.request("GET", "/public.html")
        self.assertEqual(redirect_status, 301)
        self.assertEqual(redirect_headers["Location"], "/")

        robots_status, _, robots_body = self.request("GET", "/robots.txt")
        self.assertEqual(robots_status, 200)
        self.assertIn(b"Disallow: /api/", robots_body)
        self.assertIn(b"Sitemap: https://maison-des-erables.example/sitemap.xml", robots_body)

        sitemap_status, _, sitemap_body = self.request("GET", "/sitemap.xml")
        self.assertEqual(sitemap_status, 200)
        self.assertIn(b"<loc>https://maison-des-erables.example/</loc>", sitemap_body)

    def test_non_public_routes_send_noindex_header(self):
        status, headers, _ = self.request("GET", "/api/public-site")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("X-Robots-Tag"), "noindex, nofollow")

        status, headers, _ = self.request("GET", "/gestion/")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("X-Robots-Tag"), "noindex, nofollow")

    def test_login_rate_limit_after_10_attempts(self):
        for _ in range(srv.LOGIN_MAX_ATTEMPTS):
            status, _, _ = self.request("POST", "/api/login", {"password": "wrong"})
            self.assertEqual(status, 401)
        status, _, payload = self.request("POST", "/api/login", {"password": "wrong"})
        self.assertEqual(status, 429)
        self.assertIn("tentatives", payload["error"].lower())

    def test_state_requires_auth_and_expired_session_is_rejected(self):
        status, _, _ = self.request("GET", "/api/state")
        self.assertEqual(status, 401)
        cookie = self.login()
        status, _, _ = self.request("GET", "/api/state", cookie=cookie)
        self.assertEqual(status, 200)
        with srv.get_connection() as conn:
            conn.execute("UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00'")
            conn.commit()
        status, _, _ = self.request("GET", "/api/state", cookie=cookie)
        self.assertEqual(status, 401)

    def test_state_never_leaks_smtp_password(self):
        cookie = self.login()
        _, _, state = self.request("GET", "/api/state", cookie=cookie)
        settings = state["settings"]
        settings["notifications"]["smtpHost"] = "smtp.example.com"
        settings["notifications"]["smtpUser"] = "me@example.com"
        settings["notifications"]["smtpPassword"] = "s3cr3t"
        settings["_versions"] = state["versions"]
        status, _, _ = self.request("POST", "/api/settings", settings, cookie=cookie)
        self.assertEqual(status, 200)
        _, _, state2 = self.request("GET", "/api/state", cookie=cookie)
        notif = state2["settings"]["notifications"]
        self.assertEqual(notif["smtpPassword"], "")
        self.assertTrue(notif["smtpConfigured"])

    def test_availability_excludes_booked_room(self):
        with srv.get_connection() as conn:
            reservation = {
                "id": "res1", "groupId": None, "bookingType": "reservation",
                "status": "confirmed", "bookingName": "R1", "roomId": "chambre-1",
                "arrivalDate": "2026-08-10", "departureDate": "2026-08-14",
                "clientName": "C", "clientContact": "c@e.com", "platform": "Airbnb",
                "amount": 100.0, "comment": "", "createdAt": "2026-06-01T00:00:00",
                "updatedAt": "2026-06-01T00:00:00",
            }
            srv.upsert_reservations_db(conn, [reservation])
            conn.commit()
        _, _, data = self.request("GET", "/api/availability?arrivalDate=2026-08-11&departureDate=2026-08-13")
        room_ids = {r["id"] for r in data["rooms"]}
        self.assertNotIn("chambre-1", room_ids)
        self.assertIn("chambre-2", room_ids)

    def test_room_availability_returns_monthly_days(self):
        with srv.get_connection() as conn:
            reservation = {
                "id": "res1", "groupId": None, "bookingType": "reservation",
                "status": "confirmed", "bookingName": "R1", "roomId": "chambre-1",
                "arrivalDate": "2026-08-10", "departureDate": "2026-08-12",
                "clientName": "C", "clientContact": "c@e.com", "platform": "Airbnb",
                "amount": 100.0, "comment": "", "createdAt": "2026-06-01T00:00:00",
                "updatedAt": "2026-06-01T00:00:00",
            }
            srv.upsert_reservations_db(conn, [reservation])
            conn.commit()

        status, _, data = self.request("GET", "/api/room-availability?roomId=chambre-1&year=2026&month=8")

        self.assertEqual(status, 200)
        by_date = {item["date"]: item["available"] for item in data["days"]}
        self.assertFalse(by_date["2026-08-10"])
        self.assertFalse(by_date["2026-08-11"])
        self.assertTrue(by_date["2026-08-12"])

    def test_booking_request_then_accept_creates_reservation(self):
        payload = {
            "roomId": "chambre-1", "arrivalDate": "2026-09-01", "departureDate": "2026-09-03",
            "guestName": "Client Web", "guestContact": "web@example.com", "guestCount": 2,
            "message": "Bonjour",
        }
        status, _, created = self.request("POST", "/api/booking-requests", payload)
        self.assertEqual(status, 201)
        request_id = created["bookingRequest"]["id"]
        cookie = self.login()
        status, _, result = self.request(
            "POST", f"/api/booking-requests/{request_id}", {"action": "accept"}, cookie=cookie
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(result["reservations"]), 1)
        self.assertEqual(result["reservations"][0]["roomId"], "chambre-1")

    def test_cancelled_reservation_fee_is_exposed_and_cleared_on_reactivation(self):
        cookie = self.login()
        _, _, state = self.request("GET", "/api/state", cookie=cookie)
        payload = {
            "id": "cancelled-fee",
            "bookingType": "reservation",
            "status": "cancelled",
            "roomId": "chambre-1",
            "arrivalDate": "2026-11-10",
            "departureDate": "2026-11-12",
            "clientName": "Client Annulé",
            "clientContact": "client@example.com",
            "platform": state["settings"]["platforms"][0],
            "amount": 240,
            "cancellationFee": 48.5,
            "comment": "Annulation tardive",
            "_versions": state["versions"],
        }

        status, _, saved = self.request("POST", "/api/reservations", payload, cookie=cookie)

        self.assertEqual(status, 200)
        reservation = next(item for item in saved["reservations"] if item["id"] == "cancelled-fee")
        self.assertEqual(reservation["cancellationFee"], 48.5)
        _, _, backup = self.request("GET", "/api/backup", cookie=cookie)
        backed_up = next(item for item in backup["reservations"] if item["id"] == "cancelled-fee")
        self.assertEqual(backed_up["cancellationFee"], 48.5)

        reservation["status"] = "confirmed"
        reservation["cancellationFee"] = 48.5
        reservation["_versions"] = saved["versions"]
        status, _, reactivated = self.request("POST", "/api/reservations", reservation, cookie=cookie)

        self.assertEqual(status, 200)
        updated = next(item for item in reactivated["reservations"] if item["id"] == "cancelled-fee")
        self.assertEqual(updated["cancellationFee"], 0)

    def test_restore_legacy_reservation_defaults_cancellation_fee_to_zero(self):
        cookie = self.login()
        _, _, state = self.request("GET", "/api/state", cookie=cookie)
        legacy_reservation = {
            "id": "legacy-cancelled",
            "bookingType": "reservation",
            "status": "cancelled",
            "roomId": "chambre-1",
            "arrivalDate": "2026-12-01",
            "departureDate": "2026-12-03",
            "clientName": "Ancien client",
            "clientContact": "ancien@example.com",
            "platform": state["settings"]["platforms"][0],
            "amount": 180,
            "comment": "Ancienne sauvegarde",
        }

        status, _, restored = self.request(
            "POST",
            "/api/restore",
            {"settings": state["settings"], "reservations": [legacy_reservation]},
            cookie=cookie,
        )

        self.assertEqual(status, 200)
        self.assertEqual(restored["reservations"][0]["cancellationFee"], 0)

    def test_upload_multipart_valid_and_invalid(self):
        cookie = self.login()
        body, headers = self._multipart(PNG_1X1, "image/png")
        status, _, payload = self.request("POST", "/api/upload", body, headers, cookie=cookie)
        self.assertEqual(status, 201)
        url = payload["url"]
        self.assertTrue(url.startswith("/uploads/"))
        status, get_headers, _ = self.request("GET", url)
        self.assertEqual(status, 200)
        self.assertIn("immutable", get_headers.get("Cache-Control", ""))
        body, headers = self._multipart(b"not a png", "image/png")
        status, _, _ = self.request("POST", "/api/upload", body, headers, cookie=cookie)
        self.assertEqual(status, 400)

    def test_remove_room_deletes_photo_row_and_file(self):
        cookie = self.login()
        body, headers = self._multipart(PNG_1X1, "image/png")
        _, _, up = self.request("POST", "/api/upload", body, headers, cookie=cookie)
        photo_url = up["url"]
        photo_file = srv.UPLOADS_DIR / pathlib.Path(photo_url).name
        old = 1_000_000_000  # vieillir le fichier pour contourner la grâce d'1 h du GC
        os.utime(photo_file, (old, old))
        _, _, state = self.request("GET", "/api/state", cookie=cookie)
        settings = state["settings"]
        settings["rooms"][0]["photos"] = [{"url": photo_url, "alt": ""}]
        settings["_versions"] = state["versions"]
        status, _, _ = self.request("POST", "/api/settings", settings, cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(photo_file.exists(), "la photo référencée doit rester")
        _, _, state2 = self.request("GET", "/api/state", cookie=cookie)
        settings2 = state2["settings"]
        settings2["rooms"] = [r for r in settings2["rooms"] if r["id"] != "chambre-1"]
        settings2["_versions"] = state2["versions"]
        status, _, _ = self.request("POST", "/api/settings", settings2, cookie=cookie)
        self.assertEqual(status, 200)
        with srv.get_connection() as conn:
            rows = conn.execute(
                "SELECT COUNT(*) FROM room_photos WHERE room_id = 'chambre-1'"
            ).fetchone()[0]
        self.assertEqual(rows, 0, "les room_photos de la chambre supprimée doivent disparaître")
        self.assertFalse(photo_file.exists(), "le fichier orphelin doit être nettoyé")


if __name__ == "__main__":
    unittest.main()
