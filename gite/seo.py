from __future__ import annotations

import html
import json
import re
from urllib.parse import quote_plus, urljoin, urlparse


DEFAULT_ADDRESS_DETAILS = {
    "streetAddress": "",
    "postalCode": "",
    "addressLocality": "",
    "addressRegion": "",
    "addressCountry": "FR",
}

DEFAULT_SEO_SETTINGS = {
    "publicUrl": "",
    "published": False,
    "titleOverride": "",
    "descriptionOverride": "",
}


def normalize_address_details(value) -> dict:
    raw = value if isinstance(value, dict) else {}
    return {
        key: str(raw.get(key, default)).strip()
        for key, default in DEFAULT_ADDRESS_DETAILS.items()
    }


def format_address(details: dict) -> str:
    normalized = normalize_address_details(details)
    locality = " ".join(
        part for part in [normalized["postalCode"], normalized["addressLocality"]] if part
    )
    return ", ".join(
        part
        for part in [normalized["streetAddress"], locality, normalized["addressRegion"]]
        if part
    )


def normalize_public_url(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        return raw
    path = parsed.path.rstrip("/")
    if path:
        return raw
    return f"{parsed.scheme.lower()}://{parsed.netloc}/"


def validate_public_url(value) -> str:
    normalized = normalize_public_url(value)
    if not normalized:
        return ""
    parsed = urlparse(normalized)
    is_local = (parsed.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme not in ({"http", "https"} if is_local else {"https"}):
        raise ValueError("L’URL publique doit utiliser HTTPS.")
    if not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("L’URL publique est invalide.")
    if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
        raise ValueError("L’URL publique doit viser la racine du domaine.")
    return f"{parsed.scheme.lower()}://{parsed.netloc}/"


def normalize_seo_settings(value) -> dict:
    raw = value if isinstance(value, dict) else {}
    return {
        "publicUrl": normalize_public_url(raw.get("publicUrl", "")),
        "published": bool(raw.get("published", False)),
        "titleOverride": str(raw.get("titleOverride", "")).strip(),
        "descriptionOverride": str(raw.get("descriptionOverride", "")).strip(),
    }


def collapse_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def shorten_description(value: str, limit: int = 160) -> str:
    text = collapse_text(value)
    if len(text) <= limit:
        return text
    shortened = text[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:-")
    if not shortened:
        shortened = text[: limit - 1].rstrip()
    return f"{shortened}…"


def build_seo_title(public_site: dict) -> str:
    site = public_site.get("site", {})
    seo = normalize_seo_settings(site.get("seo"))
    if seo["titleOverride"]:
        return collapse_text(seo["titleOverride"])
    property_name = collapse_text(public_site.get("propertyName")) or "Chambres d’hôtes"
    locality = normalize_address_details(site.get("addressDetails"))["addressLocality"]
    prefix = f"Chambres d’hôtes à {locality}" if locality else "Chambres d’hôtes"
    return f"{prefix} | {property_name}"


def build_seo_description(public_site: dict) -> str:
    site = public_site.get("site", {})
    seo = normalize_seo_settings(site.get("seo"))
    source = seo["descriptionOverride"] or next(
        (
            value
            for value in [site.get("intro"), site.get("giteDescription"), public_site.get("description")]
            if collapse_text(value)
        ),
        "",
    )
    return shorten_description(source)


def publication_errors(settings: dict) -> list[str]:
    site = settings.get("site", {})
    seo = normalize_seo_settings(site.get("seo"))
    details = normalize_address_details(site.get("addressDetails"))
    errors = []
    try:
        public_url = validate_public_url(seo["publicUrl"])
    except ValueError as exc:
        errors.append(str(exc))
        public_url = ""
    if not public_url:
        errors.append("Renseignez l’URL publique du site.")
    if collapse_text(settings.get("propertyName")).lower() in {"", "mon gîte", "mon gite"}:
        errors.append("Personnalisez le nom du gîte.")
    required_address = {
        "streetAddress": "la rue",
        "postalCode": "le code postal",
        "addressLocality": "la commune",
        "addressCountry": "le pays",
    }
    missing = [label for key, label in required_address.items() if not details[key]]
    if missing:
        errors.append(f"Complétez l’adresse structurée ({', '.join(missing)}).")
    if not build_seo_description(settings):
        errors.append("Ajoutez une introduction ou une présentation du gîte.")
    if not any(room.get("publicVisible", True) for room in settings.get("rooms", [])):
        errors.append("Rendez au moins une chambre visible sur la vitrine.")
    return errors


def publication_warnings(settings: dict) -> list[str]:
    site = settings.get("site", {})
    rooms = [room for room in settings.get("rooms", []) if room.get("publicVisible", True)]
    warnings = []
    if not site.get("heroImageUrl") and not site.get("gitePhotos") and not any(room.get("photos") for room in rooms):
        warnings.append("Ajoutez une image pour les aperçus sociaux.")
    if not site.get("phone"):
        warnings.append("Ajoutez un téléphone public pour renforcer les informations locales.")
    if not site.get("email"):
        warnings.append("Ajoutez un email public.")
    if any(not collapse_text(room.get("description")) for room in rooms):
        warnings.append("Certaines chambres n’ont pas de description détaillée.")
    photos = list(site.get("gitePhotos", [])) + [photo for room in rooms for photo in room.get("photos", [])]
    if any(not collapse_text(photo.get("alt")) for photo in photos):
        warnings.append("Certaines photos n’ont pas de texte alternatif.")
    return warnings


def _escape_json_for_html(value) -> str:
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _absolute_url(base_url: str, value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return value
    return urljoin(base_url, value.lstrip("/")) if base_url else ""


def _image_urls(public_site: dict) -> list[str]:
    site = public_site.get("site", {})
    base_url = normalize_seo_settings(site.get("seo"))["publicUrl"]
    raw_images = [site.get("heroImageUrl", "")]
    raw_images.extend(photo.get("url", "") for photo in site.get("gitePhotos", []))
    for room in public_site.get("rooms", []):
        raw_images.extend(photo.get("url", "") for photo in room.get("photos", []))
    images = []
    for value in raw_images:
        absolute = _absolute_url(base_url, value)
        if absolute and absolute not in images:
            images.append(absolute)
    return images


def build_structured_data(public_site: dict) -> dict | None:
    site = public_site.get("site", {})
    seo = normalize_seo_settings(site.get("seo"))
    details = normalize_address_details(site.get("addressDetails"))
    if not seo["publicUrl"] or not all(details[key] for key in ("streetAddress", "postalCode", "addressLocality", "addressCountry")):
        return None
    description = build_seo_description(public_site)
    images = _image_urls(public_site)
    website_id = f"{seo['publicUrl']}#website"
    lodging_id = f"{seo['publicUrl']}#lodging"
    lodging = {
        "@type": "BedAndBreakfast",
        "@id": lodging_id,
        "name": public_site.get("propertyName", ""),
        "url": seo["publicUrl"],
        "address": {"@type": "PostalAddress", **details},
        "numberOfRooms": len(public_site.get("rooms", [])),
    }
    if description:
        lodging["description"] = description
    if site.get("phone"):
        lodging["telephone"] = site["phone"]
    if site.get("email"):
        lodging["email"] = site["email"]
    if images:
        lodging["image"] = images
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "@id": website_id,
                "url": seo["publicUrl"],
                "name": public_site.get("propertyName", ""),
                "publisher": {"@id": lodging_id},
            },
            lodging,
        ],
    }


def _render_head(public_site: dict) -> str:
    site = public_site.get("site", {})
    seo = normalize_seo_settings(site.get("seo"))
    title = build_seo_title(public_site)
    description = build_seo_description(public_site)
    images = _image_urls(public_site)
    tags = [f'<meta name="description" content="{html.escape(description, quote=True)}" />'] if description else []
    tags.append(f'<meta name="robots" content="{"index, follow" if seo["published"] else "noindex, follow"}" />')
    if seo["publicUrl"]:
        tags.extend(
            [
                f'<link rel="canonical" href="{html.escape(seo["publicUrl"], quote=True)}" />',
                '<meta property="og:type" content="website" />',
                f'<meta property="og:url" content="{html.escape(seo["publicUrl"], quote=True)}" />',
            ]
        )
    tags.extend(
        [
            f'<meta property="og:title" content="{html.escape(title, quote=True)}" />',
            f'<meta property="og:site_name" content="{html.escape(public_site.get("propertyName", ""), quote=True)}" />',
            f'<meta name="twitter:card" content="{"summary_large_image" if images else "summary"}" />',
            f'<meta name="twitter:title" content="{html.escape(title, quote=True)}" />',
        ]
    )
    if description:
        escaped = html.escape(description, quote=True)
        tags.extend([f'<meta property="og:description" content="{escaped}" />', f'<meta name="twitter:description" content="{escaped}" />'])
    if images:
        escaped_image = html.escape(images[0], quote=True)
        tags.extend([f'<meta property="og:image" content="{escaped_image}" />', f'<meta name="twitter:image" content="{escaped_image}" />'])
    structured_data = build_structured_data(public_site)
    if structured_data:
        tags.append(f'<script type="application/ld+json">{_escape_json_for_html(structured_data)}</script>')
    return "\n    ".join(tags)


def _room_image(room: dict) -> str:
    photos = room.get("photos") or []
    if not photos:
        return ""
    photo = photos[0]
    return (
        f'<img src="{html.escape(str(photo.get("url", "")), quote=True)}" '
        f'alt="{html.escape(str(photo.get("alt") or room.get("name", "")), quote=True)}" loading="lazy" />'
    )


def _render_rooms(public_site: dict) -> str:
    cards = []
    for room in public_site.get("rooms", []):
        room_id = html.escape(str(room.get("id", "")), quote=True)
        name = html.escape(str(room.get("name", "")))
        summary = html.escape(str(room.get("summary", "")))
        description = html.escape(str(room.get("description", "")))
        capacity = html.escape(str(room.get("capacity", 2)))
        amenities = "".join(
            f'<span class="pill pill-outline">{html.escape(str(item))}</span>'
            for item in (room.get("amenities") or [])[:5]
        )
        links = "".join(
            f'<a class="btn btn-secondary btn-md btn-full public-room-card-link" href="{html.escape(str(link.get("url", "")), quote=True)}" target="_blank" rel="noopener noreferrer">{html.escape(str(link.get("label") or "Réserver"))}</a>'
            for link in room.get("bookingLinks", [])
        )
        request_button = (
            f'<button class="btn btn-primary btn-md btn-full" type="button" data-action="request" data-request-room="{room_id}">Demander cette chambre</button>'
            if room.get("bookingRequestsEnabled", True)
            else ""
        )
        cards.append(
            f'''<article class="public-room-card" data-room-id="{room_id}">
          <div class="public-room-card-photo">{_room_image(room)}</div>
          <div class="public-room-card-body">
            <div class="public-room-card-header"><div><h3 class="public-room-card-name">{name}</h3><p class="public-room-card-meta">{summary + " · " if summary else ""}jusqu’à {capacity} pers</p></div></div>
            {f'<p class="public-room-card-description">{description}</p>' if description else ''}
            {f'<div class="public-room-card-amenities">{amenities}</div>' if amenities else ''}
            <div class="public-room-card-actions">{request_button}{links}</div>
          </div>
        </article>'''
        )
    if cards:
        return "\n        ".join(cards)
    return '<div class="public-no-avail"><h3 class="public-no-avail-title">Aucune chambre disponible</h3><p class="public-no-avail-meta">Revenez bientôt pour découvrir nos hébergements.</p></div>'


def _render_gite_photo(site: dict) -> str:
    photos = site.get("gitePhotos") or []
    if not photos:
        return ""
    photo = photos[0]
    return (
        f'<img src="{html.escape(str(photo.get("url", "")), quote=True)}" '
        f'alt="{html.escape(str(photo.get("alt") or site.get("giteTitle") or "Le gîte"), quote=True)}" loading="lazy" />'
    )


def _render_contact(public_site: dict) -> tuple[str, str]:
    site = public_site.get("site", {})
    rows = []
    if site.get("address"):
        rows.append(f'<div class="public-contact-row"><span>{html.escape(site["address"])}</span></div>')
    if site.get("phone"):
        phone = str(site["phone"])
        phone_href = html.escape(re.sub(r"\s+", "", phone), quote=True)
        rows.append(f'<div class="public-contact-row"><a href="tel:{phone_href}">{html.escape(phone)}</a></div>')
    if site.get("email"):
        email = str(site["email"])
        rows.append(f'<div class="public-contact-row"><a href="mailto:{html.escape(email, quote=True)}">{html.escape(email)}</a></div>')
    contact = f'<div class="public-contact-list">{"".join(rows)}</div>' if rows else '<p class="public-section-intro">Contactez-nous via une demande de réservation.</p>'
    map_html = ""
    if site.get("address"):
        query = html.escape(quote_plus(str(site["address"])), quote=True)
        map_html = f'<div class="public-contact-map"><iframe title="Carte {html.escape(str(public_site.get("propertyName", "")), quote=True)}" loading="lazy" src="https://www.google.com/maps?q={query}&amp;z=10&amp;output=embed"></iframe></div>'
    return contact, map_html


def render_public_page(template: str, public_site: dict) -> str:
    site = public_site.get("site", {})
    property_name = html.escape(str(public_site.get("propertyName", "")))
    title = html.escape(build_seo_title(public_site))
    contact_html, map_html = _render_contact(public_site)
    has_gite = bool(collapse_text(site.get("giteDescription")) or site.get("gitePhotos"))
    hero_style = ""
    if site.get("heroImageUrl"):
        css_url = json.dumps(str(site["heroImageUrl"]), ensure_ascii=False)
        hero_style = f' style="background-image:url({html.escape(css_url, quote=True)})"'
    logo = ""
    brand_class = ""
    if site.get("logoUrl"):
        logo = f'<img id="public-footer-logo" class="public-footer-logo" src="{html.escape(str(site["logoUrl"]), quote=True)}" alt="Logo {property_name}" />'
        brand_class = " is-hidden"
    replacements = {
        "{{SEO_TITLE}}": title,
        "{{SEO_HEAD}}": _render_head(public_site),
        "{{PROPERTY_NAME}}": property_name,
        "{{HERO_STYLE}}": hero_style,
        "{{HEADLINE}}": html.escape(str(site.get("headline") or public_site.get("propertyName", ""))),
        "{{SUBTITLE}}": html.escape(str(site.get("subtitle", ""))),
        "{{INTRO}}": html.escape(str(site.get("intro") or public_site.get("description", ""))),
        "{{ROOMS_HTML}}": _render_rooms(public_site),
        "{{GITE_SECTION_CLASS}}": " is-hidden" if not has_gite else "",
        "{{GITE_TITLE}}": html.escape(str(site.get("giteTitle") or "Le gîte")),
        "{{GITE_DESCRIPTION}}": html.escape(str(site.get("giteDescription", ""))),
        "{{GITE_CAROUSEL}}": _render_gite_photo(site),
        "{{CONTACT_HTML}}": contact_html,
        "{{CONTACT_MAP_HTML}}": map_html,
        "{{CONTACT_MAP_CLASS}}": " is-hidden" if not map_html else "",
        "{{FOOTER_LOGO}}": logo,
        "{{FOOTER_BRAND_CLASS}}": brand_class,
        "{{PUBLIC_BOOTSTRAP}}": _escape_json_for_html(public_site),
    }
    rendered = template
    for marker, value in replacements.items():
        rendered = rendered.replace(marker, value)
    return rendered


def build_robots_txt(public_site: dict) -> str:
    seo = normalize_seo_settings(public_site.get("site", {}).get("seo"))
    lines = ["User-agent: *", "Allow: /", "Disallow: /gestion/", "Disallow: /api/"]
    if seo["publicUrl"]:
        lines.extend(["", f"Sitemap: {seo['publicUrl']}sitemap.xml"])
    return "\n".join(lines) + "\n"


def build_sitemap_xml(public_site: dict) -> str:
    seo = normalize_seo_settings(public_site.get("site", {}).get("seo"))
    url = seo["publicUrl"] if seo["published"] else ""
    entry = f"\n  <url><loc>{html.escape(url)}</loc></url>" if url else ""
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entry}\n</urlset>\n'
