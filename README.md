# fantasy-AI-agent
An AI front office for my Sleeper league, THE DYNASTY.

- `server.js` + `index.html`: the front office dashboard. Double-click `start.bat` (or run `node start.js`), open http://localhost:3000
- `start.js` + `start.bat`: the auto-updater. Starts the server, checks GitHub every 5 minutes, pulls down new app files and restarts the server when its code changed. Never touches `data/`, `.env` or players files.
- `watch.js`: the 24/7 watcher. GitHub Actions runs it every ~15 minutes and posts new league moves and injuries on my team to Discord.
- `staff.js`: the AI staff. GitHub Actions runs it every morning, Thursday before kickoff and Sunday before the early games. Posts the report to Discord and saves `data/brief.json`.
- `learn.js`: the film room. Every staff run first grades last week's calls against what really happened (Sleeper points) and what I actually did (who I started, added, traded), then writes `data/lessons.json`. Every report and every conversation reads those lessons, so the staff gets sharper each week on its own.
- Game mode: hit **▶ PLAY** on the HQ to walk the facility in first person (WASD + mouse, E to talk to a staffer, T or the 📋 TO-DO tab for the to-do list). The stadium jumbotron shows every matchup, and when my matchup is live a game plays on the field.
- To talk to the staff on the PC, put `ANTHROPIC_API_KEY=sk-ant-...` in a file named `.env` next to `start.bat` (it never leaves the PC).
- `data/`: the watcher's latest league snapshot, the staff report, pre-game report history and the film-room lessons.

Secrets (Settings → Secrets and variables → Actions): `ANTHROPIC_API_KEY` for the staff, `DISCORD_WEBHOOK` for Discord.

Discord: add the webhook URL as a repo secret named `DISCORD_WEBHOOK` (Settings → Secrets and variables → Actions).
