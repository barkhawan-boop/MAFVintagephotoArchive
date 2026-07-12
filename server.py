from __future__ import annotations

import argparse
import cgi
import hashlib
import hmac
import html
import mimetypes
import os
import re
import shutil
import sqlite3
import time
import urllib.parse
import uuid
from datetime import datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("ARCHIVE_DATA_DIR", BASE_DIR / "data")).resolve()
UPLOAD_DIR = Path(os.environ.get("ARCHIVE_UPLOAD_DIR", BASE_DIR / "uploads")).resolve()
DB_PATH = Path(os.environ.get("ARCHIVE_DB_PATH", DATA_DIR / "archive.db")).resolve()
STATIC_DIR = (BASE_DIR / "static").resolve()

ADMIN_USER = os.environ.get("ARCHIVE_ADMIN_USER", "Admin")
ADMIN_PASSWORD = os.environ.get("ARCHIVE_ADMIN_PASSWORD", "Admin123")
SECRET_KEY = os.environ.get("ARCHIVE_SECRET_KEY", "family-archive-development-key")
MAX_UPLOAD_MB = int(os.environ.get("ARCHIVE_MAX_UPLOAD_MB", "25"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"}
STATUS_LABELS = {
    "pending": "چاوەڕوان",
    "approved": "پەسەندکراو",
    "disapproved": "پەسەندنەکراو",
}


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    ensure_storage()
    with connect_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL UNIQUE,
                original_filename TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                year_taken TEXT NOT NULL DEFAULT '',
                people_names TEXT NOT NULL DEFAULT '',
                uploaded_by TEXT NOT NULL DEFAULT '',
                album TEXT NOT NULL DEFAULT 'ئەلبوومی خێزان',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_year ON photos(year_taken)")


def esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def display_date(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
        return parsed.strftime("%Y/%m/%d")
    except ValueError:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.strftime("%Y/%m/%d")
        except ValueError:
            return value


def split_people(value: str) -> list[str]:
    parts = re.split(r"[,;]", value or "")
    return [part.strip() for part in parts if part.strip()]


def clean_text(value: str, max_length: int = 240) -> str:
    value = re.sub(r"\s+", " ", value or "").strip()
    return value[:max_length]


def clean_year(value: str) -> str:
    return clean_text(value, 80)


def safe_filename(filename: str) -> tuple[str, str]:
    original = Path(filename or "").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", original).strip(".-")
    if not cleaned:
        cleaned = "photo"
    extension = Path(cleaned).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise ValueError(f"جۆری فایل پشتگیری ناکرێت. یەکێک لەم جۆرانە بەکاربهێنە: {allowed}.")
    saved_name = f"{uuid.uuid4().hex}{extension}"
    return saved_name, original or saved_name


def sign_session(username: str, expires_at: int) -> str:
    payload = f"{username}|{expires_at}"
    signature = hmac.new(SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}|{signature}"


def verify_session(token: str) -> str | None:
    parts = (token or "").split("|")
    if len(parts) != 3:
        return None
    username, expires_raw, signature = parts
    try:
        expires_at = int(expires_raw)
    except ValueError:
        return None
    if expires_at < int(time.time()):
        return None
    payload = f"{username}|{expires_at}"
    expected = hmac.new(SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    return username if username == ADMIN_USER else None


def get_cookie(headers, name: str) -> str:
    raw_cookie = headers.get("Cookie", "")
    cookie = SimpleCookie(raw_cookie)
    if name not in cookie:
        return ""
    return urllib.parse.unquote(cookie[name].value)


def status_badge(status: str) -> str:
    label = STATUS_LABELS.get(status, status.title())
    return f'<span class="badge badge-{esc(status)}">{esc(label)}</span>'


def rtl_pdf_text(value: object) -> str:
    text = str(value or "")
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
    except ImportError:
        return text
    return get_display(arabic_reshaper.reshape(text))


def pdf_para_text(value: object) -> str:
    return esc(rtl_pdf_text(value)).replace("\n", "<br/>")


def register_pdf_fonts() -> tuple[str, str]:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_dir = STATIC_DIR / "fonts"
    regular_candidates = [
        font_dir / "Sarchia_Baran.ttf",
        font_dir / "Sarchia_Baran.otf",
        font_dir / "DejaVuSans.ttf",
    ]
    bold_candidates = [
        font_dir / "Sarchia_Baran-Bold.ttf",
        font_dir / "Sarchia_Baran_Bold.ttf",
        font_dir / "DejaVuSans-Bold.ttf",
    ]
    regular_path = next((path for path in regular_candidates if path.exists()), None)
    bold_path = next((path for path in bold_candidates if path.exists()), regular_path)
    if regular_path is None:
        return "Helvetica", "Helvetica-Bold"

    try:
        pdfmetrics.getFont("ArchiveRegular")
    except KeyError:
        pdfmetrics.registerFont(TTFont("ArchiveRegular", str(regular_path)))
    try:
        pdfmetrics.getFont("ArchiveBold")
    except KeyError:
        pdfmetrics.registerFont(TTFont("ArchiveBold", str(bold_path or regular_path)))
    return "ArchiveRegular", "ArchiveBold"


def get_all_photo_rows() -> list[sqlite3.Row]:
    with connect_db() as conn:
        return conn.execute(
            """
            SELECT *
            FROM photos
            ORDER BY album COLLATE NOCASE ASC, year_taken DESC, created_at DESC
            """
        ).fetchall()


def fit_pdf_image(image_path: Path, max_width: float, max_height: float):
    from PIL import Image, ImageFile, ImageOps
    from reportlab.platypus import Image as RLImage

    ImageFile.LOAD_TRUNCATED_IMAGES = True
    with Image.open(image_path) as source:
        normalized = ImageOps.exif_transpose(source)
        if normalized.mode in {"RGBA", "LA"}:
            background = Image.new("RGB", normalized.size, "white")
            alpha = normalized.getchannel("A") if "A" in normalized.getbands() else None
            background.paste(normalized.convert("RGBA"), mask=alpha)
            normalized = background
        elif normalized.mode != "RGB":
            normalized = normalized.convert("RGB")
        width, height = normalized.size
        image_buffer = BytesIO()
        normalized.save(image_buffer, format="JPEG", quality=92)
        image_buffer.seek(0)

    scale = min(max_width / width, max_height / height)
    image = RLImage(image_buffer, width=width * scale, height=height * scale)
    image._archive_image_buffer = image_buffer
    return image


def build_album_pdf() -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

    regular_font, bold_font = register_pdf_fonts()
    photos = get_all_photo_rows()
    buffer = BytesIO()
    page_width, page_height = A4
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Family Photo Archive Album",
    )

    styles = {
        "cover_title": ParagraphStyle(
            "cover_title",
            fontName=bold_font,
            fontSize=28,
            leading=36,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#274437"),
            spaceAfter=12,
        ),
        "cover_subtitle": ParagraphStyle(
            "cover_subtitle",
            fontName=regular_font,
            fontSize=13,
            leading=22,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6f6a62"),
        ),
        "album": ParagraphStyle(
            "album",
            fontName=bold_font,
            fontSize=18,
            leading=26,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#b65e42"),
            spaceBefore=4,
            spaceAfter=8,
        ),
        "title": ParagraphStyle(
            "title",
            fontName=bold_font,
            fontSize=14,
            leading=22,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#1c1c1b"),
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "body",
            fontName=regular_font,
            fontSize=10.5,
            leading=17,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#1c1c1b"),
        ),
        "label": ParagraphStyle(
            "label",
            fontName=bold_font,
            fontSize=9.2,
            leading=14,
            alignment=TA_RIGHT,
            textColor=colors.HexColor("#426b56"),
        ),
        "muted": ParagraphStyle(
            "muted",
            fontName=regular_font,
            fontSize=9.2,
            leading=15,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6f6a62"),
        ),
    }

    def para(value: object, style_name: str = "body") -> Paragraph:
        return Paragraph(pdf_para_text(value), styles[style_name])

    def detail_line(label: str, value: object) -> Paragraph:
        return para(f"{label}: {value or 'نەزانراو'}", "body")

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(regular_font, 8)
        canvas.setFillColor(colors.HexColor("#8a8278"))
        canvas.drawCentredString(page_width / 2, 8 * mm, str(document.page))
        canvas.restoreState()

    story = [
        Spacer(1, 56 * mm),
        para("ئەرشیفی وێنەی خێزانی، بنەماڵەی مامۆستا مەلا ئەمین مەلا ساڵح دوکەڵەیی", "cover_title"),
        para("ئەلبوومی چاپکراو بۆ پاراستنی وێنەکان و زانیارییەکانیان", "cover_subtitle"),
        Spacer(1, 12 * mm),
        para(f"{len(photos)} وێنە", "cover_subtitle"),
        para(f"دروستکراوە لە {display_date(datetime.now().strftime('%Y-%m-%d'))}", "cover_subtitle"),
        PageBreak(),
    ]

    if not photos:
        story.extend(
            [
                para("هێشتا هیچ وێنەیەک لە ئەرشیڤەکەدا نییە.", "cover_subtitle"),
            ]
        )
    else:
        current_album = None
        max_image_width = doc.width
        max_image_height = 120 * mm
        for index, photo in enumerate(photos, start=1):
            album = photo["album"] or "ئەلبوومی خێزان"
            if album != current_album:
                current_album = album
                story.append(para(album, "album"))

            story.append(para(f"{index}. {photo['year_taken'] or 'ساڵی نەزانراو'}", "title"))
            image_path = UPLOAD_DIR / photo["filename"]
            if image_path.exists():
                try:
                    image = fit_pdf_image(image_path, max_image_width, max_image_height)
                    image.hAlign = "CENTER"
                    story.extend([image, Spacer(1, 6 * mm)])
                except Exception:
                    story.extend([para("ئەم وێنەیە نەکرا بخرێتە ناو PDF ـەکە.", "muted"), Spacer(1, 4 * mm)])
            else:
                story.extend([para("فایلی وێنەکە نەدۆزرایەوە.", "muted"), Spacer(1, 4 * mm)])

            story.extend(
                [
                    detail_line("ساڵ", photo["year_taken"]),
                    detail_line("ناوەکان", photo["people_names"] or "هیچ ناوێک تۆمار نەکراوە"),
                    detail_line("بارکەر", photo["uploaded_by"]),
                    detail_line("ئەلبووم", photo["album"]),
                    detail_line("وەسف", photo["description"] or "هیچ وەسفێک تۆمار نەکراوە."),
                ]
            )
            if index != len(photos):
                story.append(PageBreak())

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def person_chips(people_names: str) -> str:
    people = split_people(people_names)
    if not people:
        return '<span class="muted">هیچ ناوێک تۆمار نەکراوە</span>'
    return "".join(f'<span class="chip">{esc(person)}</span>' for person in people)


def nav(is_admin: bool) -> str:
    auth_link = '<a href="/logout">چوونەدەرەوە</a>' if is_admin else '<a href="/login?next=/admin">بەڕێوەبەر</a>'
    return f"""
        <nav class="top-nav" aria-label="ڕێڕەوی سەرەکی">
            <a href="/">دەستپێک</a>
            <a href="/gallery">بینینی ئەرشیڤ</a>
            <a href="/upload">بارکردنی وێنە</a>
            {auth_link}
        </nav>
    """


def get_public_summary() -> dict[str, int]:
    with connect_db() as conn:
        approved_count = conn.execute("SELECT COUNT(*) FROM photos WHERE status = 'approved'").fetchone()[0]
        album_count = conn.execute(
            "SELECT COUNT(DISTINCT album) FROM photos WHERE status = 'approved' AND album != ''"
        ).fetchone()[0]
        people_rows = conn.execute("SELECT people_names FROM photos WHERE status = 'approved'").fetchall()
    people_count = len({person.casefold() for row in people_rows for person in split_people(row["people_names"])})
    return {
        "approved": approved_count,
        "albums": album_count,
        "people": people_count,
    }


def layout(title: str, content: str, is_admin: bool = False, flash: str = "", tone: str = "") -> str:
    flash_html = f'<div class="flash {esc(tone)}">{esc(flash)}</div>' if flash else ""
    return f"""<!doctype html>
<html lang="ckb" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{esc(title)} | ئەرشیفی وێنەی خێزانی، بنەماڵەی مامۆستا مەلا ئەمین مەلا ساڵح دوکەڵەیی</title>
    <link rel="stylesheet" href="/static/styles.css?v=ckb3">
</head>
<body>
    <header class="site-header">
        <a class="brand" href="/" aria-label="ماڵەوەی ئەرشیفی وێنەی خێزانی، بنەماڵەی مامۆستا مەلا ئەمین مەلا ساڵح دوکەڵەیی">
            <span>
                <strong>ئەرشیفی وێنەی خێزانی، بنەماڵەی مامۆستا مەلا ئەمین مەلا ساڵح دوکەڵەیی</strong>
                <small>ناوەندی یادگاریی تایبەت</small>
            </span>
        </a>
        {nav(is_admin)}
    </header>
    <main>
        {flash_html}
        {content}
    </main>
    <script src="/static/app.js?v=ckb1"></script>
</body>
</html>"""


def render_home(is_admin: bool = False) -> str:
    summary = get_public_summary()
    content = f"""
    <section class="entrance">
        <div class="entrance-copy">
            <p class="eyebrow">ناوەندی ئەرشیڤی خێزان</p>
            <h1>وێنەکان، ناوەکان، بەروارەکان و چیرۆکەکان لە یەک شوێن بهێڵەوە.</h1>
            <p class="lede">یادگاریی نوێ باربکە بۆ پێداچوونەوە، یان ئەلبوومە پەسەندکراوەکانی خێزان بە ساڵ، ئەلبووم و ناوی کەس بگەڕێ.</p>
            <div class="action-row">
                <a class="button primary" href="/upload">بارکردنی وێنە</a>
                <a class="button secondary" href="/gallery">بینینی ئەرشیڤ</a>
            </div>
            <a class="admin-entry" href="/login?next=/admin">بەشی پەسەندکردنی بەڕێوەبەر</a>
        </div>
        <div class="memory-board" aria-label="پێشبینینی ئەرشیڤ">
            <div class="photo-tile tile-wide">
                <span>ئەلبوومەکان</span>
            </div>
            <div class="photo-tile tile-tall">
                <span>کەسەکان</span>
            </div>
            <div class="photo-tile">
                <span>ساڵەکان</span>
            </div>
            <div class="photo-tile tile-dark">
                <span>چیرۆکەکان</span>
            </div>
        </div>
    </section>
    <section class="quick-stats">
        <article>
            <strong>{summary["approved"]}</strong>
            <span>وێنەی پەسەندکراو</span>
        </article>
        <article>
            <strong>{summary["albums"]}</strong>
            <span>ئەلبووم</span>
        </article>
        <article>
            <strong>{summary["people"]}</strong>
            <span>ناوی کەس</span>
        </article>
    </section>
    """
    return layout("دەستپێک", content, is_admin=is_admin)


def get_gallery_filters() -> tuple[list[str], list[str], list[str]]:
    with connect_db() as conn:
        rows = conn.execute(
            "SELECT album, year_taken, people_names FROM photos WHERE status = 'approved' ORDER BY created_at DESC"
        ).fetchall()
    albums = sorted({row["album"] for row in rows if row["album"]}, key=str.casefold)
    years = sorted({row["year_taken"] for row in rows if row["year_taken"]}, reverse=True)
    people = sorted({person for row in rows for person in split_people(row["people_names"])}, key=str.casefold)
    return albums, years, people


def query_gallery(query: dict[str, list[str]]) -> tuple[list[sqlite3.Row], dict[str, str]]:
    filters = {
        "album": clean_text(query.get("album", [""])[0], 120),
        "year": clean_text(query.get("year", [""])[0], 80),
        "person": clean_text(query.get("person", [""])[0], 120),
    }
    clauses = ["status = 'approved'"]
    params: list[str] = []
    if filters["album"]:
        clauses.append("album = ?")
        params.append(filters["album"])
    if filters["year"]:
        clauses.append("LOWER(year_taken) LIKE ?")
        params.append(f"%{filters['year'].lower()}%")
    if filters["person"]:
        clauses.append("LOWER(people_names) LIKE ?")
        params.append(f"%{filters['person'].lower()}%")
    sql = f"SELECT * FROM photos WHERE {' AND '.join(clauses)} ORDER BY year_taken DESC, created_at DESC"
    with connect_db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return rows, filters


def render_select(name: str, label: str, selected: str, options: list[str], placeholder: str) -> str:
    option_html = [f'<option value="">{esc(placeholder)}</option>']
    for option in options:
        is_selected = " selected" if option == selected else ""
        option_html.append(f'<option value="{esc(option)}"{is_selected}>{esc(option)}</option>')
    return f"""
        <label>
            <span>{esc(label)}</span>
            <select name="{esc(name)}">
                {''.join(option_html)}
            </select>
        </label>
    """


def photo_card(photo: sqlite3.Row, admin: bool = False) -> str:
    controls = ""
    if admin:
        controls = f"""
            <div class="admin-actions">
                <form method="post" action="/admin/photo/{photo['id']}/approve">
                    <button class="small success" type="submit">پەسەندکردن</button>
                </form>
                <form method="post" action="/admin/photo/{photo['id']}/disapprove">
                    <button class="small warning" type="submit">پەسەندنەکردن</button>
                </form>
                <form method="post" action="/admin/photo/{photo['id']}/delete" data-confirm="دڵنیایت دەتەوێت ئەم وێنەیە بە تەواوی بسڕیتەوە؟">
                    <button class="small danger" type="submit">سڕینەوە</button>
                </form>
            </div>
        """
    status = status_badge(photo["status"]) if admin else ""
    description = photo["description"] or "هێشتا هیچ وەسفێک زیاد نەکراوە."
    year = photo["year_taken"] or "ساڵی نەزانراو"
    uploaded_by = photo["uploaded_by"] or "نەزانراو"
    return f"""
        <article class="photo-card">
            <a class="photo-frame" href="/uploads/{esc(photo['filename'])}" target="_blank" rel="noopener">
                <img src="/uploads/{esc(photo['filename'])}" alt="{esc(description)}" loading="lazy">
            </a>
            <div class="photo-body">
                <div class="card-topline">
                    <span class="album-label">{esc(photo['album'])}</span>
                    {status}
                </div>
                <h3>{esc(year)}</h3>
                <p>{esc(description)}</p>
                <div class="chips">{person_chips(photo['people_names'])}</div>
                <dl class="meta-grid">
                    <div><dt>بارکراوە لەلایەن</dt><dd>{esc(uploaded_by)}</dd></div>
                    <div><dt>زیادکراوە</dt><dd>{esc(display_date(photo['created_at'][:10]))}</dd></div>
                </dl>
                {controls}
            </div>
        </article>
    """


def render_gallery(query: dict[str, list[str]], is_admin: bool = False) -> str:
    photos, filters = query_gallery(query)
    albums, years, people = get_gallery_filters()
    cards = "".join(photo_card(photo) for photo in photos)
    if not cards:
        cards = """
            <section class="empty-state">
                <h2>هیچ وێنەیەکی پەسەندکراو نەدۆزرایەوە</h2>
                <p>فلتەرەکان بگۆڕە، یان دوای پەسەندکردنی بارکراوە نوێکان لەلایەن بەڕێوەبەرەوە بگەڕێوە.</p>
            </section>
        """
    content = f"""
    <section class="page-heading compact">
        <p class="eyebrow">یادگارییە پەسەندکراوەکان</p>
        <h1>گەڕان لە ئەرشیڤی خێزان</h1>
    </section>
    <form class="filter-bar" method="get" action="/gallery">
        {render_select("album", "ئەلبووم", filters["album"], albums, "هەموو ئەلبوومەکان")}
        {render_select("year", "بەروار / ساڵ", filters["year"], years, "هەموو ساڵەکان")}
        {render_select("person", "ناوی کەس", filters["person"], people, "هەموو کەسەکان")}
        <div class="filter-actions">
            <button class="button primary" type="submit">فلتەرکردن</button>
            <a class="button ghost" href="/gallery">پاککردنەوە</a>
        </div>
    </form>
    <section class="gallery-grid">
        {cards}
    </section>
    """
    return layout("بینین", content, is_admin=is_admin)


def render_login(next_path: str = "/admin", error: str = "") -> str:
    error_html = f'<p class="form-error">{esc(error)}</p>' if error else ""
    content = f"""
    <section class="form-shell narrow">
        <div class="panel">
            <p class="eyebrow">چوونەژوورەوەی بەڕێوەبەر</p>
            <h1>چوونەژوورەوە</h1>
            <p class="muted">ناوی بەکارهێنەر و وشەی نهێنی ئەرشیڤ بەکاربهێنە بۆ بارکردنی وێنە یان بەڕێوەبردنی پەسەندکردنەکان.</p>
            {error_html}
            <form class="stacked-form" method="post" action="/login">
                <input type="hidden" name="next" value="{esc(next_path)}">
                <label>
                    <span>ناوی بەکارهێنەر</span>
                    <input name="username" autocomplete="username" required>
                </label>
                <label>
                    <span>وشەی نهێنی</span>
                    <input name="password" type="password" autocomplete="current-password" required>
                </label>
                <button class="button primary full" type="submit">چوونەژوورەوە</button>
            </form>
        </div>
    </section>
    """
    return layout("چوونەژوورەوە", content, is_admin=False)


def render_upload(is_admin: bool, query: dict[str, list[str]], error: str = "") -> str:
    success = query.get("success", [""])[0] == "1"
    success_html = ""
    if success:
        success_html = """
            <div class="inline-note success-note">
                وێنەکە بارکرا. پێش ئەوەی سەردانکەران بیبینن، لە بەشی پەسەندکردنی بەڕێوەبەردا چاوەڕوانە.
            </div>
        """
    error_html = f'<p class="form-error">{esc(error)}</p>' if error else ""
    content = f"""
    <section class="form-shell">
        <div class="panel upload-panel">
            <div>
                <p class="eyebrow">یادگاریی نوێ</p>
                <h1>بارکردنی وێنە</h1>
                <p class="muted">وردەکارییەکانی چیرۆکەکە زیاد بکە بۆ ئەوەی دواتر بە ئەلبووم، ساڵ و ناوی کەس بدۆزرێتەوە.</p>
            </div>
            {success_html}
            {error_html}
            <form class="stacked-form" method="post" action="/upload" enctype="multipart/form-data">
                <label class="file-picker">
                    <span>وێنە</span>
                    <input name="photo" type="file" accept="image/*" required data-preview-input>
                    <img class="preview-image" alt="" data-preview-image hidden>
                </label>
                <label>
                    <span>ناوی ئەلبووم</span>
                    <input name="album" placeholder="نموونە: ماڵی کۆنی خێزان" maxlength="120">
                </label>
                <label>
                    <span>وەسف</span>
                    <textarea name="description" rows="4" placeholder="کێ، لە کوێ، و چی ڕوویداوە؟" maxlength="600"></textarea>
                </label>
                <div class="two-column">
                    <label>
                        <span>ساڵی گرتنی وێنە</span>
                        <input name="year_taken" dir="auto" placeholder="1998 / نزیکەی 1998 / بە تەخمین" maxlength="80">
                    </label>
                    <label>
                        <span>کەسی بارکەر</span>
                        <input name="uploaded_by" placeholder="ناوی تۆ" maxlength="120" required>
                    </label>
                </div>
                <label>
                    <span>کەسانی ناو وێنەکە</span>
                    <input name="people_names" placeholder="ناوەکان بە کۆما جیا بکەوە" maxlength="300">
                </label>
                <button class="button primary full" type="submit">بارکردن بۆ پەسەندکردن</button>
            </form>
        </div>
    </section>
    """
    return layout("بارکردنی وێنە", content, is_admin=is_admin)


def get_admin_rows(status_filter: str) -> list[sqlite3.Row]:
    params: list[str] = []
    where = ""
    if status_filter in STATUS_LABELS:
        where = "WHERE status = ?"
        params.append(status_filter)
    with connect_db() as conn:
        return conn.execute(
            f"SELECT * FROM photos {where} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC",
            params,
        ).fetchall()


def get_counts() -> dict[str, int]:
    counts = {"all": 0, "pending": 0, "approved": 0, "disapproved": 0}
    with connect_db() as conn:
        rows = conn.execute("SELECT status, COUNT(*) AS total FROM photos GROUP BY status").fetchall()
    for row in rows:
        status = row["status"]
        if status in counts:
            counts[status] = row["total"]
            counts["all"] += row["total"]
    return counts


def render_admin(query: dict[str, list[str]], is_admin: bool, flash: str = "", tone: str = "") -> str:
    status_filter = clean_text(query.get("status", ["pending"])[0], 20)
    if status_filter not in {*STATUS_LABELS.keys(), "all"}:
        status_filter = "pending"
    rows = get_admin_rows(status_filter)
    counts = get_counts()
    tabs = []
    for key, label in [("pending", "چاوەڕوان"), ("approved", "پەسەندکراو"), ("disapproved", "پەسەندنەکراو"), ("all", "هەموو")]:
        selected = " active" if key == status_filter else ""
        tabs.append(f'<a class="tab{selected}" href="/admin?status={key}">{label} <span>{counts[key]}</span></a>')
    cards = "".join(photo_card(row, admin=True) for row in rows)
    if not cards:
        cards = """
            <section class="empty-state">
                <h2>هیچ وێنەیەک لەم ڕیزەدا نییە</h2>
                <p>بارکراوە نوێکان سەرەتا وەک چاوەڕوان لێرە دەردەکەون.</p>
            </section>
        """
    content = f"""
    <section class="page-heading admin-heading">
        <div>
            <p class="eyebrow">مێزی پەسەندکردن</p>
            <h1>بەشی بەڕێوەبەر</h1>
            <p class="muted">وێنەکان بۆ گەلەری گشتی پەسەند بکە، پەسەندیان مەکە، یان بە تەواوی بیانسرەوە.</p>
        </div>
        <div class="admin-heading-actions">
            <a class="button primary" href="/admin/album.pdf">داگرتنی ئەلبوومی PDF</a>
            <a class="button secondary" href="/upload">بارکردنی وێنە</a>
        </div>
    </section>
    <nav class="tabs" aria-label="فلتەرەکانی دۆخی بەڕێوەبەر">
        {''.join(tabs)}
    </nav>
    <section class="gallery-grid admin-grid">
        {cards}
    </section>
    """
    return layout("بەڕێوەبەر", content, is_admin=is_admin, flash=flash, tone=tone)


class ArchiveHandler(BaseHTTPRequestHandler):
    server_version = "FamilyArchive/1.0"

    def log_message(self, format: str, *args) -> None:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.address_string()} {format % args}")

    def current_user(self) -> str | None:
        token = get_cookie(self.headers, "archive_session")
        return verify_session(token)

    def is_admin(self) -> bool:
        return self.current_user() is not None

    def send_html(self, html_body: str, status: HTTPStatus = HTTPStatus.OK, extra_headers: dict[str, str] | None = None) -> None:
        body = html_body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location: str, extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()

    def require_admin(self, next_path: str) -> bool:
        if self.is_admin():
            return True
        self.redirect(f"/login?next={urllib.parse.quote(next_path)}")
        return False

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith("/static/"):
            self.serve_file(STATIC_DIR, path.removeprefix("/static/"))
            return
        if path.startswith("/uploads/"):
            self.serve_file(UPLOAD_DIR, path.removeprefix("/uploads/"))
            return
        if path == "/":
            self.send_html(render_home(is_admin=self.is_admin()))
            return
        if path == "/gallery":
            self.send_html(render_gallery(query, is_admin=self.is_admin()))
            return
        if path == "/login":
            next_path = query.get("next", ["/admin"])[0]
            self.send_html(render_login(next_path=next_path))
            return
        if path == "/logout":
            headers = {"Set-Cookie": "archive_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"}
            self.redirect("/", extra_headers=headers)
            return
        if path == "/upload":
            self.send_html(render_upload(is_admin=False, query=query))
            return
        if path == "/admin":
            if not self.require_admin("/admin"):
                return
            self.send_html(render_admin(query, is_admin=True))
            return
        if path == "/admin/album.pdf":
            if not self.require_admin("/admin/album.pdf"):
                return
            self.handle_album_pdf()
            return
        self.not_found()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/login":
            self.handle_login()
            return
        if path == "/upload":
            self.handle_upload()
            return
        match = re.fullmatch(r"/admin/photo/(\d+)/(approve|disapprove|delete)", path)
        if match:
            if not self.require_admin("/admin"):
                return
            photo_id = int(match.group(1))
            action = match.group(2)
            self.handle_admin_action(photo_id, action)
            return
        self.not_found()

    def serve_file(self, root: Path, requested_path: str) -> None:
        safe_parts = [part for part in requested_path.split("/") if part and part not in {".", ".."}]
        file_path = (root.joinpath(*safe_parts)).resolve()
        if root not in file_path.parents and file_path != root:
            self.not_found()
            return
        if not file_path.is_file():
            self.not_found()
            return
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.send_header("X-Content-Type-Options", "nosniff")
        if root == UPLOAD_DIR:
            self.send_header("Cache-Control", "private, max-age=3600")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        with file_path.open("rb") as file:
            shutil.copyfileobj(file, self.wfile)

    def parse_form_urlencoded(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8")
        parsed = urllib.parse.parse_qs(body, keep_blank_values=True)
        return {key: values[0] if values else "" for key, values in parsed.items()}

    def parse_multipart(self) -> cgi.FieldStorage:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > MAX_UPLOAD_BYTES + 1024 * 512:
            raise ValueError(f"بارکردنەکە زۆر گەورەیە. گەورەترین قەبارەی وێنە {MAX_UPLOAD_MB} MB ـە.")
        environ = {
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(length),
        }
        return cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ=environ, keep_blank_values=True)

    def handle_login(self) -> None:
        form = self.parse_form_urlencoded()
        username = clean_text(form.get("username", ""), 120)
        password = form.get("password", "")
        next_path = form.get("next", "/admin") or "/admin"
        if not next_path.startswith("/") or next_path.startswith("//"):
            next_path = "/admin"
        if username == ADMIN_USER and password == ADMIN_PASSWORD:
            expires_at = int(time.time()) + 60 * 60 * 12
            token = urllib.parse.quote(sign_session(username, expires_at))
            cookie = f"archive_session={token}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax"
            self.redirect(next_path, extra_headers={"Set-Cookie": cookie})
            return
        self.send_html(render_login(next_path=next_path, error="ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە."), HTTPStatus.UNAUTHORIZED)

    def handle_album_pdf(self) -> None:
        try:
            body = build_album_pdf()
        except Exception as exc:
            content = f"""
            <section class="empty-state">
                <h1>PDF دروست نەکرا</h1>
                <p>{esc(str(exc))}</p>
                <a class="button primary" href="/admin">گەڕانەوە بۆ بەڕێوەبەر</a>
            </section>
            """
            self.send_html(layout("هەڵەی PDF", content, is_admin=True), HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", 'attachment; filename="family-photo-album.pdf"')
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_upload(self) -> None:
        try:
            form = self.parse_multipart()
            photo_item = form["photo"] if "photo" in form else None
            if isinstance(photo_item, list):
                photo_item = photo_item[0] if photo_item else None
            if photo_item is None or not getattr(photo_item, "filename", ""):
                raise ValueError("تکایە وێنەیەک هەڵبژێرە بۆ بارکردن.")

            filename, original_filename = safe_filename(photo_item.filename)
            description = clean_text(form.getfirst("description", ""), 600)
            year_taken = clean_year(form.getfirst("year_taken", ""))
            people_names = clean_text(form.getfirst("people_names", ""), 300)
            uploaded_by = clean_text(form.getfirst("uploaded_by", ""), 120)
            album = clean_text(form.getfirst("album", ""), 120) or year_taken or "ئەلبوومی خێزان"
            if not uploaded_by:
                raise ValueError("تکایە ناوی کەسی بارکەر بنووسە.")

            target = UPLOAD_DIR / filename
            with target.open("wb") as output:
                shutil.copyfileobj(photo_item.file, output)
            if target.stat().st_size == 0:
                target.unlink(missing_ok=True)
                raise ValueError("وێنەی هەڵبژێردراو بەتاڵ بوو.")
            if target.stat().st_size > MAX_UPLOAD_BYTES:
                target.unlink(missing_ok=True)
                raise ValueError(f"بارکردنەکە زۆر گەورەیە. گەورەترین قەبارەی وێنە {MAX_UPLOAD_MB} MB ـە.")

            with connect_db() as conn:
                conn.execute(
                    """
                    INSERT INTO photos (
                        filename, original_filename, description, year_taken,
                        people_names, uploaded_by, album, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (filename, original_filename, description, year_taken, people_names, uploaded_by, album, now_iso()),
                )
            self.redirect("/upload?success=1")
        except ValueError as exc:
            self.send_html(render_upload(is_admin=False, query={}, error=str(exc)), HTTPStatus.BAD_REQUEST)

    def handle_admin_action(self, photo_id: int, action: str) -> None:
        with connect_db() as conn:
            row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
            if row is None:
                self.redirect("/admin?status=all")
                return
            if action == "approve":
                conn.execute("UPDATE photos SET status = 'approved' WHERE id = ?", (photo_id,))
                self.redirect("/admin?status=pending")
                return
            if action == "disapprove":
                conn.execute("UPDATE photos SET status = 'disapproved' WHERE id = ?", (photo_id,))
                self.redirect("/admin?status=pending")
                return
            if action == "delete":
                conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
                (UPLOAD_DIR / row["filename"]).unlink(missing_ok=True)
                self.redirect("/admin?status=all")
                return
        self.not_found()

    def not_found(self) -> None:
        content = """
        <section class="empty-state not-found">
            <h1>پەڕەکە نەدۆزرایەوە</h1>
            <p>ئەو پەڕەی ئەرشیڤەی داوات کردبوو بوونی نییە.</p>
            <a class="button primary" href="/">گەڕانەوە بۆ دەستپێک</a>
        </section>
        """
        self.send_html(layout("نەدۆزرایەوە", content, is_admin=self.is_admin()), HTTPStatus.NOT_FOUND)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Family Photo Archive web app.")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    return parser.parse_args()


def main() -> None:
    init_db()
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), ArchiveHandler)
    print(f"Family Photo Archive running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Family Photo Archive")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
