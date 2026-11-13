# Dynasty HQ build backlog

The nightly build session takes the **first unchecked item**, builds it, tests it, pushes it, and checks it off.
Aiden (or Claude in chat) can reorder, add or remove items at any time.

## Rules for every build
- Plain Node 18+ and plain browser JS. No npm installs, no build step, no CDNs except the Google Fonts link already in index.html. The 3D scene is hand-written WebGL in index.html.
- `node server.js` must keep working on Aiden's Windows PC (serves index.html and the /api/* routes).
- Never break `watch.js`, `staff.js`, `nfl_knowledge.py` or the workflows in `.github/workflows/`.
- Test before pushing: `node --check`, run against mocked Sleeper/Anthropic data, and screenshot the page in headless Chrome (`/usr/bin/google-chrome` + Python Playwright, SwiftShader WebGL). Sleeper, ESPN and Anthropic are not reachable from the build workspace.
- Never commit secrets. The repo is public.
- Aiden's style: Retro Bowl vibe but in 3D (chunky voxel art, pixel font, bright colors), feels alive like a game lobby, desktop first, organized and readable.

## Backlog
- [ ] **Organized facility instead of the floating island.** Rebuild the 3D HQ as a real team facility: a front office building with a hallway and four rooms in a row (Head Coach, Scout, Analyst, Manager), each with a glass front so you can see the staffer working, and the practice field plus a small stadium beside the building on solid ground (no floating island, no void underneath). Keep the camera mostly framed on the building (gentle sway, drag to orbit, scroll to zoom, click a room to fly in). Keep the live hooks: HQ.update(state), injury beacon, toasts, room labels with each staffer's status, scoreboard with week and record.
- [ ] **Staff reports inside the HQ.** Each room's wall screen shows that staffer's latest real output from the brief (Head Coach: top start/sit call; Scout: top waiver move; Analyst: top trade target; Manager: next text to send). Add a `/api/report` route in server.js that serves `data/brief.json` when no ANTHROPIC_API_KEY is set locally, so the HQ shows the overnight GitHub report.
- [ ] **League stadium view.** A second 3D scene (toggle button) with this week's matchups as scoreboards around a stadium, Aiden's matchup in the middle and live score bars.
- [ ] **Film study in the app.** Show the nightly nflverse numbers (`data/nfl/knowledge.json`: trend, target share, snap share, defense rank vs position) next to each player in the Lineup tab, with up/down trend arrows.
