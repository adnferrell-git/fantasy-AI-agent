// start.js: runs the front office and keeps it up to date by itself.
// Double-click start.bat (or run `node start.js`) instead of `node server.js`.
// Every few minutes it checks GitHub for a new version of the app. If one is out,
// it downloads the changed files, and restarts the server when server.js changed.
// Your data folder, .env and players files are never touched.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const REPO = 'adnferrell-git/fantasy-AI-agent';
const API = process.env.UPDATE_API || `https://api.github.com/repos/${REPO}/commits/main`;
const RAW = process.env.UPDATE_RAW || `https://raw.githubusercontent.com/${REPO}`;
const FILES = ['index.html', 'server.js', 'staff.js', 'watch.js', 'nfl_knowledge.py', 'README.md', 'BACKLOG.md'];
const RESTART_ON = new Set(['server.js', 'staff.js']);
const EVERY_MIN = Number(process.env.UPDATE_EVERY_MIN || 5);
const DIR = __dirname;
const STAMP = path.join(DIR, '.app-version');

let child = null, restarting = false, lastSha = '';
try { lastSha = fs.readFileSync(STAMP, 'utf8').trim(); } catch {}

const log = (...a) => console.log(`[updater ${new Date().toLocaleTimeString()}]`, ...a);

function startServer() {
  child = spawn(process.execPath, ['server.js'], { cwd: DIR, stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    child = null;
    if (restarting) return;
    log(`server stopped (code ${code}), starting it again in 3s`);
    setTimeout(startServer, 3000);
  });
}

function restartServer() {
  if (!child) return startServer();
  restarting = true;
  child.once('exit', () => { restarting = false; startServer(); });
  child.kill();
}

async function latestSha() {
  const r = await fetch(API, { headers: { 'User-Agent': 'dynasty-hq-updater', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub said ${r.status}`);
  return (await r.json()).sha;
}

// A new JS file only goes live if Node can parse it, so a bad push can't break the app.
function looksValid(name, tmp) {
  if (!name.endsWith('.js')) return true;
  return spawnSync(process.execPath, ['--check', tmp]).status === 0;
}

async function checkForUpdate() {
  let sha;
  try { sha = await latestSha(); } catch (e) { return log('could not reach GitHub:', e.message); }
  if (!sha || sha === lastSha) return;

  const changed = [];
  for (const name of FILES) {
    try {
      const r = await fetch(`${RAW}/${sha}/${name}`);
      if (r.status === 404) continue;            // file not in the repo (yet)
      if (!r.ok) throw new Error(`status ${r.status}`);
      const body = Buffer.from(await r.arrayBuffer());
      if (!body.length) throw new Error('empty file');
      const dest = path.join(DIR, name);
      let current = null;
      try { current = fs.readFileSync(dest); } catch {}
      if (current && current.equals(body)) continue;
      const tmp = path.join(DIR, '.new-' + name);
      fs.writeFileSync(tmp, body);
      if (!looksValid(name, tmp)) { fs.unlinkSync(tmp); log(`skipped ${name}: the new version has an error`); continue; }
      fs.renameSync(tmp, dest);
      changed.push(name);
    } catch (e) {
      return log(`update paused, ${name} failed to download (${e.message}); will retry`);
    }
  }

  lastSha = sha;
  try { fs.writeFileSync(STAMP, sha); } catch {}
  if (!changed.length) return;
  log('updated:', changed.join(', '));
  if (changed.some((f) => RESTART_ON.has(f))) { log('restarting the server with the new code'); restartServer(); }
  else if (changed.includes('index.html')) log('new page ready, refresh your browser');
}

(async () => {
  log('checking for updates...');
  await checkForUpdate();
  if (!child) startServer();
  setInterval(checkForUpdate, EVERY_MIN * 60 * 1000);
})();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restarting = true; if (child) child.kill(); process.exit(0); });
