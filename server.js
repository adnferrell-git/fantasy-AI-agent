// server.js - THE DYNASTY front office. Run: node server.js  (Node 18+, no installs)
// Optional: set ANTHROPIC_API_KEY to wake up the AI staff.
const http = require('http'), fs = require('fs');
const USERNAME = 'AFERR', LEAGUE_NAME = 'THE DYNASTY';
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const B = 'https://api.sleeper.app/v1';
const get = async p => { const r = await fetch(B + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
let players = {}, S = null, brief = null, briefAt = 0;
let byeCache = { key: '', set: new Set() };
let oppMap = {}, kickMap = {};
async function byeSet(season, wk) {
  const key = season + '-' + wk;
  if (byeCache.key === key) return byeCache.set;
  try {
    if (wk >= 1 && wk <= 18) {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${wk}`);
      const j = await r.json(), playing = new Set();
      const opp = {}, kick = {};
      (j.events || []).forEach(e => (e.competitions || []).forEach(c => { const ab = (c.competitors || []).map(t => (t.team.abbreviation === 'WSH' ? 'WAS' : t.team.abbreviation)); ab.forEach(x => { playing.add(x); kick[x] = e.date; }); if (ab.length === 2) { opp[ab[0]] = ab[1]; opp[ab[1]] = ab[0]; } }));
      if (playing.size >= 20) {
        oppMap = opp; kickMap = kick;
        const set = new Set();
        Object.values(players).forEach(p => { if (p.team && !playing.has(p.team)) set.add(p.team); });
        byeCache = { key, set };
        return set;
      }
    }
  } catch {}
  return new Set();
}
const SERVER = require.main === module; // false when staff.js loads this file on GitHub
const alerted = new Set(), WEBHOOK = process.env.DISCORD_WEBHOOK || '';
async function ping(msg) { if (!WEBHOOK || !SERVER) return; try { await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: msg }) }); } catch {} }

const TL_FILE = 'trade-log.json';
let TL = { done: [], trades: {} };
try { TL = JSON.parse(fs.readFileSync(TL_FILE, 'utf8')); } catch {}
async function updateTradeLog(id, wk, tm) {
  try {
    for (let w = 1; w <= wk; w++) {
      if (TL.done.includes(w) && w < wk - 1) continue;
      const txs = await get(`/league/${id}/transactions/${w}`);
      (txs || []).filter(t => t.type === 'trade' && t.status === 'complete').forEach(t => {
        const sides = {};
        const side = rid => (sides[rid] = sides[rid] || { owner: tm(rid), gets: [] });
        Object.entries(t.adds || {}).forEach(([p, rid]) => side(rid).gets.push(pl(p).name + ' (' + (pl(p).pos || '?') + ')'));
        (t.draft_picks || []).forEach(p => side(p.owner_id).gets.push(`${p.season} round ${p.round} pick`));
        TL.trades[t.transaction_id] = { week: w, created: t.created, sides: Object.values(sides) };
      });
      if (w < wk && !TL.done.includes(w)) TL.done.push(w);
    }
    fs.writeFileSync(TL_FILE, JSON.stringify(TL));
  } catch (e) { console.error('trade log failed:', e.message); }
  return Object.values(TL.trades).sort((a, b) => (b.created || 0) - (a.created || 0));
}

const statCache = {};
async function statLinesFor(season, wk, ids, rec) {
  try {
    if (wk <= 1) return [];
    const w = wk - 1, key = season + '-' + w;
    if (!statCache[key]) {
      let data = null;
      for (const u of [`https://api.sleeper.app/stats/nfl/${season}/${w}?season_type=regular`, `${B}/stats/nfl/regular/${season}/${w}`]) {
        try { const r = await fetch(u); if (r.ok) { data = await r.json(); if (data) break; } } catch {}
      }
      const map = {};
      if (Array.isArray(data)) data.forEach(x => { if (x && x.player_id && x.stats) map[x.player_id] = x.stats; });
      else if (data && typeof data === 'object') Object.entries(data).forEach(([k, v]) => { if (v && typeof v === 'object') map[k] = v.stats || v; });
      if (!Object.keys(map).length) return [];
      statCache[key] = map;
    }
    const map = statCache[key], pk = rec >= 1 ? 'pts_ppr' : rec >= 0.5 ? 'pts_half_ppr' : 'pts_std';
    const lines = [];
    for (const id of ids) {
      const st = map[id]; if (!st) continue;
      const n = k => +st[k] || 0, parts = [];
      if (n('pass_yd')) parts.push(`${n('pass_yd')} pass yds`);
      if (n('pass_td')) parts.push(`${n('pass_td')} pass TD`);
      if (n('rush_att') || n('rush_yd')) parts.push(`${n('rush_att')} car, ${n('rush_yd')} rush yds`);
      if (n('rec')) parts.push(`${n('rec')} rec, ${n('rec_yd')} rec yds`);
      const td = n('rush_td') + n('rec_td'); if (td) parts.push(`${td} TD`);
      if (n('fgm')) parts.push(`${n('fgm')} FG`);
      if (!parts.length) continue;
      lines.push(`WK${w} ${pl(id).name}: ${parts.join(', ')}` + (st[pk] != null ? ` (${st[pk]} pts)` : ''));
    }
    return lines.slice(0, 14);
  } catch { return []; }
}

let trendAt = 0, trendRaw = [];
async function trendingFreeAgents(rostered) {
  try {
    if (Date.now() - trendAt > 6e5) { trendRaw = await get('/players/nfl/trending/add?lookback_hours=48&limit=40'); trendAt = Date.now(); }
    return trendRaw.filter(x => !rostered.has(x.player_id)).map(x => ({ ...pl(x.player_id), adds: x.count }))
      .filter(p => ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.pos) && !p.inj).slice(0, 8);
  } catch { return []; }
}

async function loadPlayers() {
  try { if (Date.now() - fs.statSync('players.json').mtimeMs < 864e5) return JSON.parse(fs.readFileSync('players.json')); } catch {}
  const p = await get('/players/nfl'); fs.writeFileSync('players.json', JSON.stringify(p)); return p;
}
const pl = id => {
  const p = players[id];
  return p ? { id, name: p.full_name || [p.first_name, p.last_name].join(' '), pos: p.position, team: p.team || 'FA', inj: p.injury_status || null, age: p.age } : { id, name: id };
};

async function refresh() {
  const u = await get('/user/' + USERNAME), st = await get('/state/nfl');
  const ls = await get(`/user/${u.user_id}/leagues/nfl/${st.season}`);
  const lg = ls.find(l => l.name.toLowerCase() === LEAGUE_NAME.toLowerCase()) || ls[0];
  const id = lg.league_id, wk = Math.max(+st.week || 1, 1);
  const [users, rosters, mu, tx] = await Promise.all([
    get(`/league/${id}/users`), get(`/league/${id}/rosters`),
    get(`/league/${id}/matchups/${wk}`), get(`/league/${id}/transactions/${wk}`)]);
  const name = {}; users.forEach(x => name[x.user_id] = x.display_name);
  const owner = {}; rosters.forEach(r => owner[r.roster_id] = name[r.owner_id] || 'Team ' + r.roster_id);
  const teams = rosters.map(r => ({
    owner: owner[r.roster_id], mine: r.owner_id === u.user_id,
    record: `${r.settings.wins}-${r.settings.losses}`,
    starters: (r.starters || []).map(pl),
    bench: (r.players || []).filter(x => !(r.starters || []).includes(x)).map(pl)
  }));
  const bye = await byeSet(st.season, wk);
  teams.forEach(t => [...t.starters, ...t.bench].forEach(p => { p.bye = bye.has(p.team); p.opp = oppMap[p.team] || null; p.kick = kickMap[p.team] || null; }));
  const g = {}; mu.forEach(m => { (g[m.matchup_id] = g[m.matchup_id] || []).push({ o: owner[m.roster_id], p: m.points }); });
  const games = Object.values(g).filter(x => x.length === 2).map(([a, b]) => ({ a: a.o, ap: a.p, b: b.o, bp: b.p }));
  const tm = id => owner[id] || 'Team ' + id;
  const moves = (tx || []).filter(t => t.status === 'complete').sort((a, b) => b.created - a.created).slice(0, 15).map(t =>
    `${t.type.toUpperCase()}: ` + [
      ...Object.entries(t.adds || {}).map(([p, r]) => `${tm(r)} adds ${pl(p).name}`),
      ...Object.entries(t.drops || {}).map(([p, r]) => `${tm(r)} drops ${pl(p).name}`)].join(', '));
  const injuries = teams.flatMap(t => [...t.starters, ...t.bench].filter(p => p.inj).map(p => ({ ...p, owner: t.owner, mine: t.mine })));
  const mine = teams.find(t => t.mine), bad = ['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus'];
  const alerts = mine ? mine.starters.filter(p => p.bye || (p.inj && bad.includes(p.inj))).map(p => ({ name: p.name, pos: p.pos, team: p.team, status: (p.inj && bad.includes(p.inj)) ? p.inj : 'on bye', replacements: mine.bench.filter(x => x.pos === p.pos && !x.inj && !x.bye).map(x => x.name) })) : [];
  for (const a of alerts) { const k = a.name + a.status; if (!alerted.has(k)) { alerted.add(k); ping(`INJURY on your team: ${a.name} (${a.pos}) is ${a.status}.` + (a.replacements.length ? ` Bench option: ${a.replacements.join(', ')}` : ' No healthy bench player at that position.')); } }
  let lock = null;
  if (mine) {
    const ks = mine.starters.filter(p => p.kick && !p.bye).sort((a, b) => new Date(a.kick) - new Date(b.kick));
    if (ks.length) lock = { at: ks[0].kick, player: ks[0].name, team: ks[0].team };
  }
  if (lock) {
    const mins = Math.round((new Date(lock.at) - Date.now()) / 6e4), k = 'lock' + lock.at;
    const hard = alerts.filter(a => a.status !== 'Questionable');
    if (mins > 0 && mins <= 180 && hard.length && !alerted.has(k)) {
      alerted.add(k);
      ping(`Lineup locks in ${mins} min (${lock.player} kicks off first). Still needs fixing: ` + hard.map(a => `${a.name} (${a.status})`).join(', '));
    }
  }
  const tradeLog = await updateTradeLog(id, wk, tm);
  const tradeCounts = {}; tradeLog.forEach(t => t.sides.forEach(x => { tradeCounts[x.owner] = (tradeCounts[x.owner] || 0) + 1; }));
  const statLines = mine ? await statLinesFor(st.season, wk, [...mine.starters, ...mine.bench].map(p => p.id), (lg.scoring_settings || {}).rec) : [];
  const rostered = new Set(rosters.flatMap(r => [...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])]));
  const scout = await trendingFreeAgents(rostered);
  S = { updated: new Date().toISOString(), me: (teams.find(t => t.mine) || {}).owner,
    league: { name: lg.name, season: st.season, week: wk, positions: lg.roster_positions, ppr: (lg.scoring_settings || {}).rec },
    teams, games, moves, injuries, alerts, tradeLog: tradeLog.slice(0, 60), tradeCounts, statLines, scout, lock };
}

async function makeBrief() {
  if (!KEY) return { error: 'Add your ANTHROPIC_API_KEY and restart to wake up the staff.' };
  if (!S) return { error: 'Still loading the league. Try again in a minute.' };
  const me = S.teams.find(t => t.mine);
  const ctx = { league: S.league, my_team: me, games: S.games, recent_moves: S.moves, completed_trades: S.tradeLog.slice(0, 15), trade_counts: S.tradeCounts, free_agents_trending: S.scout, my_last_week_stats: S.statLines, my_alerts: S.alerts,
    other_teams: S.teams.filter(t => !t.mine).map(t => ({ owner: t.owner, record: t.record, starters: t.starters, bench: t.bench })) };
  const system = 'You run the front office of a fantasy football team: Head Coach (lineups), Assistant Coach (briefs the owner, who is the GM making the moves in Sleeper), Scout (bench, waivers), Analyst (trades), Manager (negotiation). Owner profile: likes small safe trades, packages bench depth with a good starter to land a star, picks the higher floor in close matchups but goes high ceiling when a big underdog, and only wants trades that clearly improve his team and are clear wins for the other owner (the league is stingy). Explain the why using the data given plus real NFL knowledge; never invent stats. Keep every start_sit and trade why to one short sentence under 15 words. The owner judges a trade by who he is getting first and sends the offers himself, so build each trade around a target he would want and make the why start with that player. Every trade must clearly improve his team in at least one of three ways, and the why must name which: STRONGER BENCH, MORE RELIABLE, or MORE POINTS. Skip any idea that does none of the three. For him RELIABLE means likely to stay healthy and score steady points every week, so count injury history and boom-or-bust weekly swings against a player (a back who scores 30 one week and 5 the next is not reliable), and favor durable players with steady floors. He plays to win now every year, so age and long-term value barely matter; judge players on this season only and never reject a good player just for being older. For bench targets, pick whoever is in the best spot to score the most points right now (role, touches, matchup), whether young or veteran, and never chase upside for the future. He never pitches or pressures owners, so each trade must stand on its own as fair to the other side with no sales talk; negotiation happens through counter offers. The text field is only a casual check that the owner saw the offer, never a pitch or any pressure. Always pick the highest-probability choice from the data, and rate your confidence honestly as HIGH, MEDIUM or LOW; use LOW when the data is thin. REPLACEMENTS: for every player in my_alerts, the Head Coach names exactly one replacement in replacements, never a list of options: the best bench player who can fill that slot (a flex-eligible player at another position counts), or a free agent from free_agents_trending only if no bench player works. For each replacement also decide fix: if one of your own trade ideas would fix the hole better than the backup, set fix to TRADE and trade_ref to the owner in that trade idea; otherwise BACKUP. A player out for one game is almost always BACKUP; a long-term loss can justify a TRADE, so build at least one trade idea around any long-term hole. Price the trade to the need: for a small or short-term need prefer a small cheap move that costs almost nothing, and for a serious hole expect to pay real value (such as bench depth) because the owner will likely have to; the bigger the hole and the more he needs the player, the more you can spend, but never propose a deal that hurts his team more than it helps. A boom-or-bust player may start, even in a close call, when the data says he has a high chance of booming (strong matchup, heavy usage, role) or the downside is affordable; always rate boom_chance honestly so the owner knows whether the boom is likely. Each player has opp, his opponent this week. When a start/sit is close, the Head Coach makes the call: weigh how strong the opposing defense is against that position and how many touches or targets the player is likely to get on his own team, and give one decisive START or SIT, never either/or. WAIVERS: only suggest a free agent from free_agents_trending if he is clearly more valuable than a bench player (more points now, steadier, or fills a need), and always name the bench player to drop for him; if nobody qualifies return an empty list. Never drop a starter unless he is out for the season. The owner trusts you to pick the drop: choose the player least likely to help him win this season (lowest chance to start, score, or serve as a needed backup), not simply the lowest scorer. DROPS: list his rostered players who have no value left (out for the season, lost his role, third string, nothing to start him over). Use my_last_week_stats and your NFL knowledge to judge value. completed_trades shows what owners in this league actually accept and trade_counts shows who trades most, so use them to judge what will get accepted. free_agents_trending are unowned players other managers are picking up. Reply with ONLY JSON: {"report":"3-4 sentence spoken update to the GM on injuries, results so far, how the team looks, and who needs to start this week","start_sit":[{"player":"","call":"START or SIT","boom_chance":"HIGH, MEDIUM or LOW for boom-or-bust players, N/A for steady ones","confidence":"HIGH, MEDIUM or LOW","why":""}],"replacements":[{"out":"hurt or bye starter","in":"the one best backup","fix":"BACKUP or TRADE","trade_ref":"owner of the trade idea that fixes it better, else empty","why":"under 15 words"}],"waivers":[{"add":"free agent name","drop":"his bench player to cut for him","confidence":"HIGH, MEDIUM or LOW","why":"under 15 words"}],"drops":[{"player":"his rostered player with no value left","why":"under 15 words"}],"trades":[{"to":"owner","give":["names"],"get":["names"],"drop_after":"player to cut if this trade leaves his roster too full, else empty","confidence":"HIGH, MEDIUM or LOW","why":"why it helps me and why they accept","opener":"a small fake-out offer to send first that shows what this owner values and gets him talking, under 15 words","fallback":"the counter to send if he pushes back, and the point to walk away, under 15 words","text":"a short casual text to send the owner after the offer so he sees it, under 15 words"}]}';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 3500, system, messages: [{ role: 'user', content: JSON.stringify(ctx) }] }) });
  const j = await r.json();
  if (!r.ok) return { error: (j.error && j.error.message) || 'API error' };
  const t = j.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch { return { report: t, start_sit: [], trades: [] }; }
}

async function ask(q) {
  if (!KEY) return 'Add your ANTHROPIC_API_KEY and restart so I can answer.';
  if (!S) return 'Still loading the league, give me a minute.';
  const ctx = { league: S.league, my_team: S.teams.find(t => t.mine), games: S.games, recent_moves: S.moves, completed_trades: S.tradeLog.slice(0, 15), trade_counts: S.tradeCounts, free_agents_trending: S.scout, other_teams: S.teams.filter(t => !t.mine) };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system: 'You are the Assistant Coach talking to the GM (the owner). Answer in a few plain sentences using the league data and real NFL knowledge. Never invent stats.', messages: [{ role: 'user', content: 'League data: ' + JSON.stringify(ctx) + '\n\nQuestion: ' + q }] }) });
  const j = await r.json();
  return r.ok ? j.content.map(c => c.text || '').join('') : ((j.error && j.error.message) || 'API error');
}

async function counter(text) {
  if (!KEY) return 'Add your ANTHROPIC_API_KEY and restart so the Manager can answer.';
  if (!S) return 'Still loading the league, give me a minute.';
  const ctx = { league: S.league, my_team: S.teams.find(t => t.mine), other_teams: S.teams.filter(t => !t.mine), completed_trades: S.tradeLog.slice(0, 15), trade_counts: S.tradeCounts, my_last_week_stats: S.statLines, my_alerts: S.alerts };
  const system = 'You are the Manager in a fantasy football front office, negotiating for the owner (the GM). He pasted what another owner sent back after his offer. Start your reply with exactly one word or phrase on the first line: ACCEPT, COUNTER, or WALK AWAY. Then give a short reason in one or two sentences. If COUNTER, give the exact counter offer (what he gives and what he gets) and one short casual text he can send, with no pitch and no pressure. The owner rules: he looks first at who he is getting; a deal must improve his team (stronger bench, more reliable, or more points) and must never hurt his team more than it helps; he plays to win now so age barely matters; reliable means healthy and steady, not boom-or-bust; his league is stingy so the other side must also see a clear win; he prefers small safe moves unless the hole is serious and he needs the player; he never pressures owners. Use the data and real NFL knowledge, never invent stats, and be honest when you are unsure.';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages: [{ role: 'user', content: 'League data: ' + JSON.stringify(ctx) + '\n\nWhat the other owner sent back:\n' + text }] }) });
  const j = await r.json();
  return r.ok ? j.content.map(c => c.text || '').join('') : ((j.error && j.error.message) || 'API error');
}

if (SERVER) {
http.createServer(async (req, res) => {
  const send = (o, c = 'application/json') => { res.writeHead(200, { 'content-type': c }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  try {
    if (req.url === '/api/state') return send(S || { error: 'loading' });
    if (req.method === 'POST' && req.url === '/api/counter') { let b = ''; for await (const c of req) b += c; return send({ answer: await counter(JSON.parse(b).q) }); }
    if (req.method === 'POST' && req.url === '/api/ask') { let b = ''; for await (const c of req) b += c; return send({ answer: await ask(JSON.parse(b).q) }); }
    if (req.url.startsWith('/api/brief')) {
      if (req.url.includes('refresh') || !brief || brief.error || Date.now() - briefAt > 18e5) { brief = await makeBrief(); briefAt = Date.now(); }
      return send(brief);
    }
    send(fs.readFileSync('index.html', 'utf8'), 'text/html');
  } catch (e) { res.writeHead(500); res.end(e.message); }
}).listen(3000, () => console.log('Front office open at http://localhost:3000'));

(async () => {
  players = await loadPlayers();
  const go = () => refresh().catch(e => console.error('refresh failed:', e.message));
  await go(); setInterval(go, 6e4);
})();
}

// Used by staff.js (the scheduled AI staff on GitHub Actions).
module.exports = { async load() { players = await loadPlayers(); await refresh(); return S; }, makeBrief };
