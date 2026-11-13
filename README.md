# fantasy-AI-agent
An AI front office for my Sleeper league, THE DYNASTY.

- `server.js` + `index.html`: the front office dashboard. Run `node server.js`, open http://localhost:3000
- `watch.js`: the 24/7 watcher. GitHub Actions runs it every ~15 minutes and posts new league moves and injuries on my team to Discord.
- `data/`: the watcher's latest league snapshot and what it has already posted.

Discord: add the webhook URL as a repo secret named `DISCORD_WEBHOOK` (Settings → Secrets and variables → Actions).
