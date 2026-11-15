// learn.js - the staff grades its own past calls and learns from them, with nobody telling it anything.
// Runs inside staff.js on GitHub Actions (around the clock). Two jobs:
//  1. saveHistory: keep the last pre-game report of every week (data/history/).
//  2. review: once a week is over, check every call in that report against what really happened
//     (Sleeper points), and what the owner actually did (who he started, who he added, which trades went through).
//     The graded record, the owner's habits and a short list of lessons go to data/lessons.json,
//     and server.js feeds that file back into every report and every conversation.
const fs = require('fs'), path = require('path');
const FILE = 'data/lessons.json', HIST = 'data/history';

const blank = () => ({ updated: null, graded: [], record: {}, habits: {}, log: [], lessons: [], owner_habits: [] });
function load() { try { return { ...blank(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return blank(); } }

// Keep the report the owner saw before kickoff. Reports made after his first game kicks off don't count.
function saveHistory(S, b) {
  if (!S || !S.league || !b || b.error) return false;
  if (S.lock && new Date(S.lock.at) <= Date.now()) return false;
  fs.mkdirSync(HIST, { recursive: true });
  const keep = { made: new Date().toISOString(), season: String(S.league.season), week: S.league.week,
    start_sit: b.start_sit || [], replacements: b.replacements || [], waivers: b.waivers || [], drops: b.drops || [], trades: b.trades || [] };
  fs.writeFileSync(path.join(HIST, `week-${keep.season}-${keep.week}.json`), JSON.stringify(keep, null, 1));
  const old = fs.readdirSync(HIST).filter(f => /^week-\d+-\d+\.json$/.test(f)).sort((a, z) => { const n = f => f.match(/\d+/g).map(Number); const [s1, w1] = n(a), [s2, w2] = n(z); return s1 - s2 || w1 - w2; });
  old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(HIST, f)));
  return true;
}

const r1 = x => Math.round((+x || 0) * 10) / 10;

async function review(core, { key, model, log = console.log } = {}) {
  const { LG, S, players, nkey, get } = core.ctx();
  if (!LG || !S) return null;
  const L = load();
  let files = [];
  try { files = fs.readdirSync(HIST).filter(f => /^week-\d+-\d+\.json$/.test(f)); } catch { return L; }
  const season = String(LG.season), todo = files.map(f => { const [s, w] = f.match(/\d+/g); return { f, s, w: +w, id: `${s}-${w}` }; })
    .filter(x => !L.graded.includes(x.id) && (x.s < season || (x.s === season && x.w < LG.week))).sort((a, b) => a.s.localeCompare(b.s) || a.w - b.w);
  if (!todo.length) return L;

  // name -> Sleeper id (players on an NFL team first)
  const idx = {};
  Object.entries(players).forEach(([id, p]) => { const k = nkey(p.full_name || [p.first_name, p.last_name].join(' ')); if (!k) return; if (!idx[k] || (p.team && !players[idx[k]].team)) idx[k] = id; });
  const idOf = n => idx[nkey(String(n || '').replace(/\s*\(.*\)\s*$/, ''))];
  const ppr = (S.league.ppr ?? 1) >= 1 ? 'pts_ppr' : S.league.ppr >= .5 ? 'pts_half_ppr' : 'pts_std';
  const mine = LG.rosters.find(r => r.owner_id === LG.uid) || {};
  const newItems = [];

  for (const wk of todo) {
    let brief; try { brief = JSON.parse(fs.readFileSync(path.join(HIST, wk.f), 'utf8')); } catch { L.graded.push(wk.id); continue; }
    if (wk.s !== season) { L.graded.push(wk.id); continue; } // old season: league ids changed, skip
    let mu = [];
    try { mu = await get(`/league/${LG.id}/matchups/${wk.w}`) || []; } catch (e) { log('learn: matchups failed', e.message); continue; }
    const pts = {}; mu.forEach(m => Object.entries(m.players_points || {}).forEach(([id, v]) => { pts[id] = +v; }));
    let stats = null;
    const pointsOf = async name => {
      const id = idOf(name); if (!id) return null;
      if (pts[id] != null) return pts[id];
      if (!stats) { stats = {}; try { const r = await fetch(`https://api.sleeper.app/stats/nfl/${season}/${wk.w}?season_type=regular`); if (r.ok) { const d = await r.json(); (Array.isArray(d) ? d : Object.entries(d).map(([player_id, v]) => ({ player_id, stats: v.stats || v }))).forEach(x => { if (x && x.player_id && x.stats) stats[x.player_id] = +x.stats[ppr] || 0; }); } } catch {} }
      return stats[id] != null ? stats[id] : 0; // no stat line that week = did not score
    };
    const myWeek = mu.find(m => m.roster_id === mine.roster_id) || {};
    const started = new Set(myWeek.starters || []), owned = new Set([...(myWeek.players || []), ...(mine.players || [])]);
    const add = (staff, type, call, result, hit, followed) => newItems.push({ week: wk.w, staff, type, call, result, hit, followed });

    for (const c of brief.start_sit || []) {
      if (!c.player || !c.over) continue;
      const p = await pointsOf(c.player), o = await pointsOf(c.over); if (p == null || o == null) continue;
      const start = String(c.call).toUpperCase() !== 'SIT';
      const hit = start ? p >= o : o >= p, id = idOf(c.player);
      add('Head Coach', 'start_sit', `${start ? 'START' : 'SIT'} ${c.player} ${start ? 'over' : 'for'} ${c.over}`, `${c.player} ${r1(p)} vs ${c.over} ${r1(o)}`, hit, id ? started.has(id) === start : null);
    }
    for (const w of brief.waivers || []) {
      if (!w.add) continue;
      const a = await pointsOf(w.add), d = w.drop ? await pointsOf(w.drop) : 0; if (a == null) continue;
      const id = idOf(w.add);
      add('Scout', 'waiver', `ADD ${w.add}${w.drop ? ' / DROP ' + w.drop : ''}`, `${w.add} ${r1(a)}${w.drop ? ` vs ${w.drop} ${r1(d)}` : ''}`, a >= (d || 0), id ? owned.has(id) : null);
    }
    for (const t of (brief.trades || []).slice(0, 3)) {
      const g = (t.get || []), v = (t.give || []); if (!g.length) continue;
      let gp = 0, vp = 0; for (const n of g) gp += (await pointsOf(n)) || 0; for (const n of v) vp += (await pointsOf(n)) || 0;
      const done = (S.tradeLog || []).some(x => (x.week || 0) >= wk.w && x.sides.some(sd => sd.owner === S.me && g.every(n => sd.gets.some(z => nkey(z.replace(/\s*\(.*\)$/, '')) === nkey(n)))));
      add('Analyst', 'trade', `To ${t.to}: get ${g.join(', ')} for ${v.join(', ')}`, `get side ${r1(gp)} pts vs give side ${r1(vp)} that week`, gp >= vp, done);
    }
    L.graded.push(wk.id);
  }

  // running record per staffer, and how often the owner actually follows each kind of call
  L.log = [...newItems.reverse(), ...L.log].slice(0, 60);
  const rec = {}, hab = {};
  L.log.forEach(x => {
    const r = rec[x.staff] = rec[x.staff] || { calls: 0, right: 0 }; r.calls++; if (x.hit) r.right++;
    if (x.followed == null) return;
    const h = hab[x.type] = hab[x.type] || { calls: 0, followed: 0, right_when_ignored: 0, ignored: 0 }; h.calls++;
    if (x.followed) h.followed++; else { h.ignored++; if (x.hit) h.right_when_ignored++; }
  });
  L.record = rec; L.habits = hab; L.updated = new Date().toISOString();

  if (newItems.length) {
    let fresh = null;
    if (key) fresh = await reflect(L, key, model, log);
    if (fresh) { L.lessons = fresh.lessons; L.owner_habits = fresh.owner_habits; }
    else L.lessons = ruleLessons(L);
  }
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(L, null, 1));
  return { ...L, newItems };
}

// No AI available: plain lessons from the numbers.
function ruleLessons(L) {
  const out = [];
  Object.entries(L.record).forEach(([who, r]) => { if (r.calls >= 3) out.push(`${who} calls have been right ${r.right} of ${r.calls} times${r.right / r.calls < .5 ? ', so be more careful and lean on steadier floors' : ''}.`); });
  const names = { start_sit: 'start/sit calls', waiver: 'waiver moves', trade: 'trade ideas' };
  Object.entries(L.habits).forEach(([t, h]) => { if (h.calls >= 3) out.push(`The owner follows ${Math.round(h.followed / h.calls * 100)}% of ${names[t] || t}.`); });
  return out.slice(0, 8);
}

// The staff reviews its own tape: Claude turns the graded record into short lessons for next time.
async function reflect(L, key, model, log) {
  try {
    const system = 'You are the film-room coordinator of a fantasy football front office (Head Coach = start/sit, Scout = waivers, Analyst = trades). You get the graded record of the staff\'s past calls (what was called, what each player really scored, whether the call was right, and whether the owner followed it) plus the current lessons. Write the updated lessons the staff should apply from now on: specific and testable (name the kind of call and the pattern, with the numbers that prove it), drop lessons the new results disprove, keep ones still true. Also describe the owner\'s habits that the data shows (what kind of advice he acts on or ignores), so the staff can pitch in a way he will act on. Return only JSON: {"lessons":["max 8 short sentences"],"owner_habits":["max 4 short sentences"]}. Never invent results that are not in the data.';
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 3000, system, messages: [{ role: 'user', content: JSON.stringify({ record: L.record, follow_habits: L.habits, graded_calls: L.log.slice(0, 40), current_lessons: L.lessons, current_owner_habits: L.owner_habits }) }] }) });
    const j = await r.json();
    if (!r.ok) { log('learn: reflect failed', (j.error && j.error.message) || r.status); return null; }
    const t = (j.content || []).map(c => c.text || '').join('');
    const o = JSON.parse((t.match(/\{[\s\S]*\}/) || [t])[0]);
    return { lessons: (o.lessons || []).map(String).slice(0, 8), owner_habits: (o.owner_habits || []).map(String).slice(0, 4) };
  } catch (e) { log('learn: reflect failed', e.message); return null; }
}

module.exports = { saveHistory, review, load };
