// staff.js - wakes up the AI front office on a schedule (GitHub Actions), with no PC needed.
// Pulls THE DYNASTY, has the staff make their calls, saves data/brief.json and posts the report to Discord.
// Needs ANTHROPIC_API_KEY. DISCORD_WEBHOOK is optional.
const fs = require('fs');
const core = require('./server.js');
const WEBHOOK = process.env.DISCORD_WEBHOOK || '';

async function post(text) {
  // Discord caps a message at 2000 characters, so split on line breaks.
  const chunks = []; let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > 1900) { chunks.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) chunks.push(cur);
  for (const c of chunks) {
    console.log('[discord]\n' + c);
    if (!WEBHOOK) continue;
    const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: c }) });
    if (!r.ok) console.error('discord failed', r.status);
    await new Promise(s => setTimeout(s, 700));
  }
}

const list = (title, rows) => rows && rows.length ? `\n**${title}**\n` + rows.join('\n') : '';

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing');
  const S = await core.load();
  const b = await core.makeBrief();
  if (b.error) throw new Error(b.error);
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/brief.json', JSON.stringify({ made: new Date().toISOString(), week: S.league.week, ...b }, null, 1));

  const msg = `🏈 **FRONT OFFICE REPORT · Week ${S.league.week}**\n${b.report || ''}`
    + list('🧑‍🏫 Head Coach: start/sit', (b.start_sit || []).map(x => `• **${x.call}** ${x.player} (${x.confidence || '?'}${x.boom_chance && !/^n\/?a/i.test(x.boom_chance) ? ', boom ' + x.boom_chance : ''}): ${x.why}`))
    + list('🚑 Fixes', (b.replacements || []).map(x => `• ${x.out} out → **${x.in}**${x.fix === 'TRADE' && x.trade_ref ? ` (or the trade to ${x.trade_ref})` : ''}: ${x.why}`))
    + list('🕵️ Scout: waivers', [...(b.waivers || []).map(w => `• Add **${w.add}**, drop ${w.drop} (${w.confidence || '?'}): ${w.why}`),
                                 ...(b.drops || []).map(d => `• Drop **${d.player}**: ${d.why}`)])
    + list('🤓 Analyst: trades to send', (b.trades || []).slice(0, 3).map(x => `• To **${x.to}**: get ${(x.get || []).join(', ')} for ${(x.give || []).join(', ')} (${x.confidence || '?'})\n   ${x.why}${x.opener ? `\n   Opener: ${x.opener}` : ''}${x.text ? `\n   📱 Text: "${x.text}"` : ''}`));
  await post(msg);
  console.log('staff report done');
})().catch(e => { console.error('staff failed:', e.message); process.exit(1); });
