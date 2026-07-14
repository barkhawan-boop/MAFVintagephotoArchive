# Cloudflare Pages Setup

This project includes a Cloudflare Pages front end and Pages Functions API.
It uses one Workers KV namespace for both photo information and image files, so no R2 subscription is required.

## Required Bindings

In Cloudflare Pages, open your project, then go to:

`Settings` -> `Functions` -> `Bindings`

The repo also includes `wrangler.toml`, which can configure the binding automatically on deploy:

```toml
[[kv_namespaces]]
binding = "PHOTO_METADATA"
id = "fd7f32de96bc425a86cc767bf864daee"
```

If you add it from the dashboard instead, add this binding:

- KV namespace binding
  - Variable name: `PHOTO_METADATA`
  - Value: choose or create a KV namespace for photo information and image files

Optional environment variables:

- `ADMIN_USER`: default is `Admin`
- `ADMIN_PASSWORD`: default is `Admin123`
- `OPENAI_API_KEY`: optional, enables PDF-first RAG roots assistant answers and web fallback when PDF context is insufficient
- `OPENAI_MODEL`: optional, defaults to `gpt-5.2`
- `OPENAI_WEB_SEARCH`: optional; set to `off` to disable OpenAI Responses API web search fallback

## Pages Settings

- Branch: `main`
- Root directory: leave empty
- Build command: leave empty
- Build output directory: leave empty
- Deploy command: leave empty / None for a normal Git-connected Pages build

Do not use `npx wrangler deploy` as the Pages deploy command. That command is for Workers and fails for this repo because the app is a Pages site with a `functions/` API folder. If you deploy manually from your computer, use:

```powershell
npx wrangler pages deploy . --project-name vintagephotoarchive --branch main
```

## Routes

- `/` landing page
- `/gallery` public approved photos
- `/roots` Kurdish roots assistant
- `/upload` login-protected upload form
- `/admin` admin approval queue

Uploads are private until the admin approves them.

Because this version stores images in KV, keep individual photo uploads under 10 MB.
