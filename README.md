# Splice Server Presence Registry

When a Splice player is on your Minecraft server, their Discord Rich Presence can show **your server's
name, icon, and a short line** instead of the default Splice card — like Lunar Client. This repo is the
source of truth for that, and it's **staff-curated**: you submit a Pull Request, staff review it, and only
staff can merge. Nothing goes live until it's approved.

## How to submit your server

1. **Fork** this repository.
2. Create a folder under `servers/` named with a short id (lowercase letters, digits, hyphens):
   `servers/<your-server-id>/`
3. Add two files inside it:

   **`metadata.json`**
   ```json
   {
     "ip": "play.yourserver.net",
     "name": "Your Server",
     "details": "Ranked PvP"
   }
   ```
   | field | required | rules |
   |-------|----------|-------|
   | `ip` | yes | your connect address, `host` or `host:port` (matched against what the player connected to) |
   | `name` | yes | display name, max **32** chars |
   | `details` | no | one short line under the name, max **64** chars |

   **`icon.png`** — your server logo:
   - **PNG**, **square**, **64–1024 px**, **≤ 512 KB**.
   - On approval, staff upload this exact file to the Splice Discord app as the presence image — it's frozen
     at approval and can't be changed later without another approved PR.
4. Open a **Pull Request**. A bot automatically checks the format. If anything's wrong the check fails and
   comments what to fix — **fix it and push again**.
5. A staff member reviews and merges. Within a minute of merge the registry rebuilds and your server is live.

## Rules

- One entry per server. Duplicate IPs are rejected.
- Keep `name`/`details` clean and accurate — SFW, no misleading claims, no impersonation.
- The icon must be your own server's branding. Anything NSFW/abusive is rejected and can get you banned from
  submitting.
- Only **staff** can merge. Submissions are proposals until approved.

## For staff

- Branch protection on `main` should require: a pull request, the **Validate submissions** check passing, and
  **Code Owner review** (see `.github/CODEOWNERS`). Disallow direct pushes.
- Review the icon and text on every PR before merging — CI checks *format*, humans check *content*.
- **Upload the icon on approve:** in the Splice Discord app → **Rich Presence → Art Assets**, upload
  `servers/<id>/icon.png` with the key **`srv_<id>`** (hyphens → underscores, e.g. id `minesplice` → key
  `srv_minesplice`). The build sets each entry's `icon` to that key. Discord's URL-based external assets 401
  now, so a pre-uploaded asset key is the only way the client can show a custom image.
- On merge, `build.yml` compiles `dist/presence.json` (invalid entries auto-excluded) and publishes it +
  icons to GitHub Pages. The client reads `https://<owner>.github.io/<repo>/presence.json`.
- Validate locally: `node scripts/validate.js` — build locally: `node scripts/validate.js --build`.

See `servers/example-network/` for a working example.
