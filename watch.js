// watch.js - THE DYNASTY watcher. Runs once per call (GitHub Actions runs it every ~15 min).
// Posts new league moves and injuries on your team to Discord, and remembers what it already posted.
// Run locally: node watch.js   (Node 18+, no installs). Set DISCORD_WEBHOOK to post to Discord.
const fs = require('fs');
const USERNAME = 'AFERR', LEAGUE_NAME = 'THE DYNASTY';
const B = 'https://api.sleeper.app/v1';
const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const STATE_FILE = 'data/watch-state.json', LEAGUE_FILE = 'data/league.json';
const PLAYERS_FILE = 'players.json', PLAYERS_META = 'players-meta.json';
const BAD = ['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus'];

const get = async p => { const r = await fetch(B + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { fs.mkdirSync(require('path').dirname(f) || '.', { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };

async function post(content) {
  console.log('[discord] ' + content);
  if (!WEBHOOK) return;
  try {
    const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }) });
    if (!r.ok) console.error('discord failed', r.status);
    await new Promise(s => setTimeout(s, 600)); // stay under Discord rate limits
  } catch (e) { console.error('discord failed', e.message); }
}

// Sleeper asks that the full player list be pulled at most once a day.
async function loadPlayers() {
  const meta = readJSON(PLAYERS_META, {});
  if (fs.existsSync(PLAYERS_FILE) && Date.now() - (meta.fetchedAt || 0) < 864e5) return readJSON(PLAYERS_FILE, {});
  const p = await get('/players/nfl');
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(p));
  writeJSON(PLAYERS_META, { fetchedAt: Date.now() });
  return p;
}

async function main() {
  const players = await loadPlayers();
  const pl = id => {
    const p = players[id];
    return p ? { id, name: p.full_name || [p.first_name, p.last_name].join(' '), pos: p.position, team: p.team || 'FA', inj: p.injury_status || null } : { id, name: id };
  };

  const u = await get('/user/' + USERNAME), st = await get('/state/nfl');
  const ls = await get(`/user/${u.user_id}/leagues/nfl/${st.season}`);
  const lg = ls.find(l => l.name.toLowerCase() === LEAGUE_NAME.toLowerCase()) || ls[0];
  const id = lg.league_id, wk = Math.max(+st.week || 1, 1);
  const [users, rosters] = await Promise.all([get(`/league/${id}/users`), get(`/league/${id}/rosters`)]);
  // Check this week and last week, so moves made right as the week flips aren't missed.
  const weeks = [...new Set([Math.max(wk - 1, 1), wk])];
  const txs = (await Promise.all(weeks.map(w => get(`/league/${id}/transactions/${w}`).catch(() => [])))).flat();

  const name = {}; users.forEach(x => name[x.user_id] = x.display_name);
  const owner = {}; rosters.forEach(r => owner[r.roster_id] = name[r.owner_id] || 'Team ' + r.roster_id);
  const tm = rid => owner[rid] || 'Team ' + rid;

  const state = readJSON(STATE_FILE, null);
  const firstRun = !state;
  const S = state || { seenTx: [], alerted: [] };
  const seen = new Set(S.seenTx), alerted = new Set(S.alerted);

  // 1) League wire: every completed move we haven't posted yet.
  const fresh = txs.filter(t => t.status === 'complete' && !seen.has(t.transaction_id)).sort((a, b) => a.created - b.created);
  for (const t of fresh) {
    seen.add(t.transaction_id);
    if (firstRun) continue; // first run just learns the history, no spam
    if (t.type === 'trade') {
      const sides = {};
      const side = rid => (sides[rid] = sides[rid] || []);
      Object.entries(t.adds || {}).forEach(([p, rid]) => side(rid).push(pl(p).name + ' (' + (pl(p).pos || '?') + ')'));
      (t.draft_picks || []).forEach(p => side(p.owner_id).push(`${p.season} R${p.round} pick`));
      await post('🔁 **TRADE** in THE DYNASTY\n' + Object.entries(sides).map(([rid, g]) => `• ${tm(rid)} gets: ${g.join(', ')}`).join('\n'));
    } else {
      const parts = [
        ...Object.entries(t.adds || {}).map(([p, r]) => `${tm(r)} adds ${pl(p).name} (${pl(p).pos || '?'})`),
        ...Object.entries(t.drops || {}).map(([p, r]) => `${tm(r)} drops ${pl(p).name} (${pl(p).pos || '?'})`)];
      if (parts.length) await post(`📰 **${t.type.replace('_', ' ').toUpperCase()}**: ` + parts.join(', '));
    }
  }

  // 2) Injuries on your team: post once per player per status per week.
  const mine = rosters.find(r => r.owner_id === u.user_id);
  if (mine) {
    const starters = new Set(mine.starters || []);
    for (const pid of mine.players || []) {
      const p = pl(pid);
      if (!p.inj || !BAD.includes(p.inj)) continue;
      const key = `${st.season}-${wk}-${pid}-${p.inj}`;
      if (alerted.has(key)) continue;
      alerted.add(key);
      if (firstRun && !starters.has(pid)) continue;
      if (starters.has(pid)) {
        const backups = (mine.players || []).filter(x => !starters.has(x)).map(pl).filter(x => x.pos === p.pos && !(x.inj && BAD.includes(x.inj)));
        await post(`🚨 **Your starter ${p.name} (${p.pos}, ${p.team}) is ${p.inj}.** ` + (backups.length ? `Healthy bench ${p.pos}: ${backups.map(x => x.name).join(', ')}` : `No healthy ${p.pos} on your bench.`));
      } else {
        await post(`🩹 Bench player ${p.name} (${p.pos}, ${p.team}) is ${p.inj}.`);
      }
    }
  }

  // 3) Save a snapshot for the dashboard, and what we've already posted.
  writeJSON(LEAGUE_FILE, {
    season: st.season, week: wk, league: lg.name,
    teams: rosters.map(r => ({
      owner: tm(r.roster_id), mine: r.owner_id === u.user_id, record: `${r.settings.wins}-${r.settings.losses}`,
      starters: (r.starters || []).map(pl), bench: (r.players || []).filter(x => !(r.starters || []).includes(x)).map(pl)
    }))
  });
  writeJSON(STATE_FILE, { seenTx: [...seen].slice(-2000), alerted: [...alerted].slice(-2000) });
  console.log(`checked week ${wk}: ${fresh.length} new moves${firstRun ? ' (first run, learned history quietly)' : ''}`);
}

main().catch(e => { console.error('watch failed:', e.message); process.exit(1); });
