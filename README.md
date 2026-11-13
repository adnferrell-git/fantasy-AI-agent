# fantasy-AI-agent
An AI front office for my Sleeper league, THE DYNASTY.

- `server.js` + `index.html`: the front office dashboard. Run `node server.js`, open http://localhost:3000
- `watch.js`: the 24/7 watcher. GitHub Actions runs it every ~15 minutes and posts new league moves and injuries on my team to Discord.
- `staff.js`: the AI staff. GitHub Actions runs it every morning, Thursday before kickoff and Sunday before the early games. Posts the report to Discord and saves `data/brief.json`.
- `data/`: the watcher's latest league snapshot and what it has already posted.

Secrets (Settings → Secrets and variables → Actions): `ANTHROPIC_API_KEY` for the staff, `DISCORD_WEBHOOK` for Discord.

Discord: add the webhook URL as a repo secret named `DISCORD_WEBHOOK` (Settings → Secrets and variables → Actions).
