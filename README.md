# CKMETA V.2 — free website setup

One Node server that serves the website (`public/`) and the API (`server.js`). Anyone with the link can use it.

## What is free, and what is not
| Piece | Free option | Catch |
|---|---|---|
| Hosting | Render free web service (`render.yaml`) | Sleeps when idle; first visit after a nap takes ~1 minute |
| Database | Turso free tier | Needed because free hosts wipe local files on restart |
| AI + live web search | Gemini API free tier (`GEMINI_API_KEY`) | Daily/minute limits. Claude, ChatGPT, Grok keys are paid; add them later and results merge |
| Instagram / TikTok / YouTube data | Official APIs are free | Each needs a developer app; other people can only connect after the platform approves your app |
| Spotify artist data | Free | Public data only: followers and releases. Monthly listeners and streams are NOT in any public API |
| Apple Music | Needs Apple Developer Program (paid yearly) | Skip it for a free launch |
| SMS recovery codes | **Not free** | Twilio charges per text; trial only texts verified numbers. Without Twilio, sign up and password reset are disabled on a public site (codes are never shown outside localhost) |

## Run locally (2 minutes)
1. `cp .env.example .env`, add at least `GEMINI_API_KEY`
2. `npm install && npm start`, open http://localhost:3000
3. On localhost, SMS codes appear on screen so you can test sign up.

## Put it online
1. Push this folder to a GitHub repo.
2. turso.tech: create a free database, copy its URL and auth token into `TURSO_URL` and `TURSO_TOKEN`.
3. render.com: New > Blueprint > pick the repo. Fill the env vars. Set `BASE_URL` to your Render URL (https://…onrender.com).
4. Register each social app below using redirect URL `BASE_URL/auth/<name>/callback`.

## Register the apps (redirect URL in brackets)
- **YouTube** [`/auth/youtube/callback`]: Google Cloud Console > enable YouTube Data API v3 > OAuth client (Web). Scope: youtube.readonly. Until verified, only listed test users can connect.
- **Instagram** [`/auth/instagram/callback`]: Meta for Developers > app with "Instagram API with Instagram Login". Works for Business/Creator accounts. Add testers while in development; public use needs app review.
- **TikTok** [`/auth/tiktok/callback`]: developers.tiktok.com > app with Login Kit + Display API. Scopes user.info.basic, user.info.stats, video.list. Sandbox first, then submit for review.
- **Spotify**: developer.spotify.com/dashboard > create app > client ID and secret. Users paste their artist link; no login needed.

## Honest limits
- Hook, format and song scores come from AI models reading live web results. They are estimates, not measured performance.
- Best posting times are computed from the account's own recent posts (Instagram last 50, TikTok last 20).
- Follower growth charts were removed: platforms don't provide history. Storing daily snapshots would add them.
- X (Twitter) is not connected; its API is paid.
- Passwords are hashed with Argon2, social tokens are AES-encrypted. Keep `SESSION_SECRET` and `TOKEN_KEY` private.
- Verify current model names and tool names in each AI provider's docs; they change.
