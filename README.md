# Family Photo Archive

A small deployable web app for a private family photo hub.

## Features

- Entrance page with `Upload Photo`, `Just Want to See`, and admin approval access
- Upload form with photo, album, description, year taken, people in the photo, and uploader name
- Login-protected upload and admin sections
- Admin queue to approve, disapprove, or delete uploaded photos
- Public gallery only shows approved photos
- Gallery filters by album, year/date, and person named
- Kurdish roots assistant that searches the extracted `گولزاری مێژوو.zip` text, can use OpenAI for ChatGPT-style synthesis, and shows sources only when the user asks
- Family-tree/source assets from the archive are available inside the roots assistant
- SQLite database plus local photo storage

## Default Login

- User name: `Admin`
- Password: `Admin123`

For a real deployment, change these with environment variables:

```powershell
$env:ARCHIVE_ADMIN_USER="Admin"
$env:ARCHIVE_ADMIN_PASSWORD="your-new-password"
$env:ARCHIVE_SECRET_KEY="a-long-random-secret"
```

## Run Locally

From this folder:

```powershell
python server.py --host 127.0.0.1 --port 8000
```

Then open:

```text
http://127.0.0.1:8000
```

## Rebuild Roots Knowledge

Place `گولزاری مێژوو.zip` on the desktop and keep the replacement content PDF at `D:\book\pdf sample.pdf`, then run:

```powershell
python tools/build_roots_knowledge.py
```

This refreshes `static/roots-knowledge.json`, including PDF chunks, page labels, and the local sparse vector index used for RAG retrieval, plus the files in `static/roots-assets/`.
To use another PDF, set `ROOTS_CONTENT_PDF` to its full path before running the script.

## AI Roots Chat

The roots assistant works as a PDF-first RAG chatbot with a local evidence-based fallback. For AI-written answers and reliable web fallback when the PDF is insufficient, add these Cloudflare Pages environment variables:

- `OPENAI_API_KEY`: OpenAI API key
- `OPENAI_MODEL`: optional, defaults to `gpt-5.2`
- `OPENAI_WEB_SEARCH`: optional; set to `off` to disable the Responses API web-search fallback

## Deploy Notes

The included `render.yaml` is ready for Render. It defines a persistent disk so uploaded photos and the SQLite database survive restarts and redeploys.

Important environment variables:

- `ARCHIVE_DATA_DIR`: folder for database/storage
- `ARCHIVE_UPLOAD_DIR`: folder where photos are stored
- `ARCHIVE_DB_PATH`: SQLite database path
- `ARCHIVE_ADMIN_USER`: admin username
- `ARCHIVE_ADMIN_PASSWORD`: admin password
- `ARCHIVE_SECRET_KEY`: secret used to sign login cookies
