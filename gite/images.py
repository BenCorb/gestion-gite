"""Helpers d'image purs (sans dépendance au reste du serveur) :
- détection de type par magic bytes,
- extraction d'un fichier d'un corps multipart/form-data en stdlib pure.

Ce module est un « leaf » : il n'importe rien de `gite.app`, ce qui permet à
`app.py` de l'importer sans créer d'import circulaire (contrairement aux façades
`db/auth/repositories` qui ré-exportent depuis `app`)."""

from __future__ import annotations

from email import policy
from email.parser import BytesParser


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
