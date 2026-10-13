import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import { createClient } from '@libsql/client';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E = process.env, BASE = E.BASE_URL || 'http://localhost:3000';
const dev = /localhost/.test(BASE);           // dev mode: SMS code returned in response (never in production)
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(cookieSession({ name: 'ck', keys: [E.SESSION_SECRET || 'dev-secret'], maxAge: 30 * 864e5, sameSite: 'lax', httpOnly: true, secure: BASE.startsWith('https') }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

/* ---------- storage ---------- */
const db = createClient({ url: E.TURSO_URL || 'file:ckmeta.db', authToken: E.TURSO_TOKEN });
const Q = async (sql, a = []) => (await db.execute({ sql, args: a })).rows, one = async (sql, a) => (await Q(sql, a))[0], run = (sql, a = []) => db.execute({ sql, args: a });
await db.executeMultiple(`create table if not exists users(id integer primary key,username text unique,pw text,phone text);
create table if not exists conns(uid integer,provider text,account text,access text,refresh text,expires integer,primary key(uid,provider));
create table if not exists manual(uid integer,provider text,data text,primary key(uid,provider));`);
try { await db.execute('alter table users add column email text'); } catch {}
const KEY = crypto.createHash('sha256').update(E.TOKEN_KEY || 'dev-key').digest();
const enc = s => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv), ct = Buffer.concat([c.update(s, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const dec = s => { const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const save = (uid, p, acct, a, r, exp) => run('insert or replace into conns values(?,?,?,?,?,?)', [uid, p, acct || '', enc(a || ''), enc(r || ''), exp || 0]);

/* ---------- helpers ---------- */
const J = async (u, o) => { const r = await fetch(u, o); if (!r.ok) throw new Error(u.split('?')[0] + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 160)); return r.json(); };
const hits = new Map();
const lim = (max, gmax = max) => (q, s, n) => { const k = (q.session?.uid || q.ip) + q.path, now = Date.now(), h = hits.get(k) || [0, now + 36e5]; if (now > h[1]) { h[0] = 0; h[1] = now + 36e5; } if (++h[0] > (q.session?.uid ? max : gmax)) return s.status(429).json({ error: 'Too many requests, try again later' }); hits.set(k, h); n(); };
const need = (q, s, n) => q.session?.uid ? n() : s.status(401).json({ error: 'Log in first' });
const wrap = f => async (q, s) => { try { await f(q, s); } catch (e) { console.error(e); s.status(400).json({ error: e.message }); } };
const NAME = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', spotify: 'Spotify', apple: 'Apple Music' };
const connected = async uid => (await Q('select provider from conns where uid=?', [uid])).map(r => NAME[r.provider]);

/* ---------- email codes for password reset (Brevo free tier) ---------- */
const codes = new Map(), EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, sha = x => crypto.createHash('sha256').update(x).digest('hex');
async function sendMail(to, subject, html) {
  if (!E.BREVO_API_KEY || !E.MAIL_FROM) { if (dev) return; throw new Error('Email is not set up on this server yet'); }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': E.BREVO_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ sender: { email: E.MAIL_FROM, name: 'CKMETA' }, to: [{ email: to }], subject, htmlContent: html }) });
  if (!r.ok) throw new Error('Could not send the email');
}

/* ---------- auth routes ---------- */
app.post('/api/signup', lim(10), wrap(async (q, s) => {
  const { username = '', password = '', email = '' } = q.body;
  if (!/^[\w.]{3,24}$/.test(username)) throw new Error('Username: 3-24 letters, numbers, . or _');
  if (password.length < 6) throw new Error('Password needs 6+ characters');
  if (email && !EMAIL.test(email)) throw new Error('That email does not look right');
  if (await one('select 1 from users where username=? collate nocase', [username])) throw new Error('Username taken');
  const r = await run('insert into users(username,pw,phone,email) values(?,?,?,?)', [username, await argon2.hash(password), '', email.trim().toLowerCase() || null]);
  q.session.uid = Number(r.lastInsertRowid); s.json({ user: username });
}));
app.post('/api/login', lim(20), wrap(async (q, s) => {
  const u = await one('select * from users where username=? collate nocase', [q.body.username || '']);
  if (!u || !(await argon2.verify(u.pw, q.body.password || ''))) throw new Error('Wrong username or password');
  q.session.uid = Number(u.id); s.json({ user: u.username, connected: await connected(u.id) });
}));
app.post('/api/logout', (q, s) => { q.session = null; s.json({ ok: true }); });
app.get('/api/me', wrap(async (q, s) => { const u = q.session?.uid && await one('select id,username from users where id=?', [q.session.uid]); s.json(u ? { user: u.username, connected: await connected(u.id) } : {}); }));
app.post('/api/forgot/start', lim(10), wrap(async (q, s) => {
  const u = await one('select * from users where username=? collate nocase', [q.body.username || '']);
  if (!u) throw new Error('No account with that username');
  if (!u.email) throw new Error('This account has no recovery email');
  const c = String(100000 + crypto.randomInt(900000));
  codes.set(u.username.toLowerCase(), { hash: sha(c), exp: Date.now() + 6e5, tries: 0 });
  await sendMail(u.email, 'Your CKMETA reset code', `<p>Your code is <b>${c}</b>. It expires in 10 minutes. If you did not ask for this, ignore this email.</p>`);
  const [a, d] = u.email.split('@'); s.json({ masked: a[0] + '•••@' + d, devCode: dev ? c : undefined });
}));
app.post('/api/forgot/finish', lim(20), wrap(async (q, s) => {
  const { username = '', code = '', password = '' } = q.body, u = await one('select * from users where username=? collate nocase', [username]);
  if (!u || password.length < 8) throw new Error('Check the username and use an 8+ character password');
  const k = codes.get(u.username.toLowerCase());
  if (!k || k.exp < Date.now() || ++k.tries > 5) throw new Error('Code expired. Request a new one');
  if (sha(String(code).trim()) !== k.hash) throw new Error('Wrong code');
  codes.delete(u.username.toLowerCase());
  await run('update users set pw=? where id=?', [await argon2.hash(password), u.id]); s.json({ ok: true });
}));

/* ---------- OAuth connections (Instagram, TikTok, YouTube) ---------- */
const P = {
  youtube: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', id: E.GOOGLE_CLIENT_ID, secret: E.GOOGLE_CLIENT_SECRET, scope: 'https://www.googleapis.com/auth/youtube.readonly', extra: { access_type: 'offline', prompt: 'consent' } },
  instagram: { auth: 'https://www.instagram.com/oauth/authorize', token: 'https://api.instagram.com/oauth/access_token', id: E.IG_APP_ID, secret: E.IG_APP_SECRET, scope: 'instagram_business_basic,instagram_business_manage_insights', extra: {} },
  tiktok: { auth: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/', id: E.TIKTOK_CLIENT_KEY, secret: E.TIKTOK_CLIENT_SECRET, scope: 'user.info.basic,user.info.stats,video.list', idKey: 'client_key', extra: {} }
};
app.get('/auth/:p', need, (q, s) => {
  const c = P[q.params.p]; if (!c?.id) return s.status(400).send('Provider not configured');
  const st = crypto.randomBytes(16).toString('hex'); q.session.st = st;
  const u = new URL(c.auth);
  u.search = new URLSearchParams({ [c.idKey || 'client_id']: c.id, redirect_uri: `${BASE}/auth/${q.params.p}/callback`, response_type: 'code', scope: c.scope, state: st, ...c.extra }).toString();
  s.redirect(u.toString());
});
app.get('/auth/:p/callback', need, async (q, s) => {
  try {
    const p = q.params.p, c = P[p];
    if (!c || q.query.state !== q.session.st) throw new Error('Invalid state');
    if (!q.query.code) throw new Error(q.query.error_description || q.query.error || 'Access denied');
    let t = await J(c.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ [c.idKey || 'client_id']: c.id, client_secret: c.secret, code: q.query.code, grant_type: 'authorization_code', redirect_uri: `${BASE}/auth/${p}/callback` }) });
    if (p === 'instagram') { t = t.data?.[0] || t; const l = await J(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${c.secret}&access_token=${t.access_token}`); t = { ...t, ...l }; }
    await save(q.session.uid, p, String(t.user_id || t.open_id || ''), t.access_token, t.refresh_token, Date.now() + (t.expires_in || 3600) * 1e3);
    s.redirect('/?connected=' + p);
  } catch (e) { s.status(400).send('Connect failed: ' + e.message); }
});
async function tok(uid, p) {
  const r = await one('select * from conns where uid=? and provider=?', [uid, p]), a = dec(r.access);
  if (!r.expires || r.expires > Date.now() + 6e4) return a;
  const c = P[p]; let n;
  if (p === 'instagram') n = await J(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${a}`);
  else n = await J(c.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ [c.idKey || 'client_id']: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: dec(r.refresh) }) });
  await save(uid, p, r.account, n.access_token, n.refresh_token || dec(r.refresh), Date.now() + (n.expires_in || 3600) * 1e3);
  return n.access_token;
}
app.post('/api/disconnect/:p', need, wrap(async (q, s) => { await run('delete from conns where uid=? and provider=?', [q.session.uid, q.params.p]); cache.delete(q.session.uid); s.json({ ok: true }); }));

/* ---------- music connections (public artist data) ---------- */
let spT = { t: '', e: 0 };
const spTok = async () => { if (spT.e > Date.now()) return spT.t; const r = await J('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(E.SPOTIFY_CLIENT_ID + ':' + E.SPOTIFY_CLIENT_SECRET).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }); spT = { t: r.access_token, e: Date.now() + (r.expires_in - 60) * 1e3 }; return spT.t; };
const appleTok = () => jwt.sign({}, (E.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), { algorithm: 'ES256', expiresIn: '1h', issuer: E.APPLE_TEAM_ID, header: { alg: 'ES256', kid: E.APPLE_KEY_ID } });
app.post('/api/connect/:p', need, wrap(async (q, s) => {
  const p = q.params.p, a = String(q.body.artist || '').trim();
  const id = p === 'spotify' ? (a.match(/artist\/([A-Za-z0-9]+)/) || a.match(/^([A-Za-z0-9]{22})$/))?.[1] : p === 'apple' ? (a.match(/\/(\d{5,})/) || a.match(/^(\d{5,})$/))?.[1] : null;
  if (!id) throw new Error('Paste your artist profile link');
  await F[p](id); await save(q.session.uid, p, id, '', '', 0); cache.delete(q.session.uid); s.json({ ok: true });
}));
app.post('/api/music/manual', need, wrap(async (q, s) => {
  const p = q.body.provider === 'apple' ? 'apple' : 'spotify', d = { monthly: +q.body.monthly || 0, streams: +q.body.streams || 0, plays: +q.body.plays || 0 };
  await run('insert or replace into manual values(?,?,?)', [q.session.uid, p, JSON.stringify(d)]); cache.delete(q.session.uid); s.json({ ok: true });
}));

/* ---------- platform data fetchers ---------- */
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0, sum = a => a.reduce((x, y) => x + y, 0);
const F = {
  async youtube(t) {
    const c = (await J('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', { headers: { Authorization: 'Bearer ' + t } })).items?.[0];
    if (!c) throw new Error('No YouTube channel on this Google account');
    const s = c.statistics; return { F: +s.subscriberCount, L: 0, V: +s.viewCount, x: { Videos: +s.videoCount } };
  },
  async instagram(t) {
    const me = await J(`https://graph.instagram.com/me?fields=username,followers_count,media_count&access_token=${t}`);
    const m = (await J(`https://graph.instagram.com/me/media?fields=like_count,comments_count,timestamp,media_type&limit=50&access_token=${t}`)).data || [];
    const reels = m.filter(x => x.media_type === 'VIDEO').slice(0, 10), rv = [];
    for (const r of reels) { try { const i = await J(`https://graph.instagram.com/${r.id}/insights?metric=views&access_token=${t}`); rv.push(i.data?.[0]?.values?.[0]?.value || 0); } catch {} }
    return { F: me.followers_count, L: sum(m.map(x => x.like_count || 0)), V: sum(rv), x: { Posts: me.media_count, 'Avg likes': avg(m.map(x => x.like_count || 0)), 'Avg reel views': avg(rv), 'Story reach': 0 }, items: m.map(x => ({ ts: Date.parse(x.timestamp), eng: (x.like_count || 0) + (x.comments_count || 0) })) };
  },
  async tiktok(t) {
    const h = { Authorization: 'Bearer ' + t };
    const u = (await J('https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,likes_count,video_count', { headers: h })).data.user;
    const v = (await J('https://open.tiktokapis.com/v2/video/list/?fields=create_time,like_count,comment_count,share_count,view_count', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) })).data?.videos || [];
    return { F: u.follower_count, L: u.likes_count, V: sum(v.map(x => x.view_count || 0)), x: { Videos: u.video_count, 'Avg views': avg(v.map(x => x.view_count || 0)), Shares: sum(v.map(x => x.share_count || 0)) }, items: v.map(x => ({ ts: x.create_time * 1e3, eng: (x.like_count || 0) + (x.comment_count || 0) + (x.share_count || 0) })) };
  },
  async spotify(id) {
    const h = { Authorization: 'Bearer ' + await spTok() };
    const a = await J('https://api.spotify.com/v1/artists/' + id, { headers: h });
    const al = (await J(`https://api.spotify.com/v1/artists/${id}/albums?include_groups=album,single&limit=10`, { headers: h })).items || [];
    return { F: a.followers.total, proj: al.slice(0, 4).map(x => ({ n: x.name, t: x.album_type === 'single' ? 'Single' : 'Album', y: x.release_date.slice(0, 4), s: 0 })) };
  },
  async apple(id) {
    const r = await J(`https://api.music.apple.com/v1/catalog/us/artists/${id}/albums?limit=10`, { headers: { Authorization: 'Bearer ' + appleTok() } });
    return { proj: (r.data || []).slice(0, 4).map(x => ({ n: x.attributes.name, t: x.attributes.isSingle ? 'Single' : 'Album', y: (x.attributes.releaseDate || '').slice(0, 4), s: 0 })) };
  }
};
const cache = new Map();
app.get('/api/profile', need, wrap(async (q, s) => {
  const uid = q.session.uid, tz = +q.query.tz || 0, hit = cache.get(uid);
  if (hit && hit.e > Date.now()) return s.json(hit.v);
  const rows = await Q('select provider,account from conns where uid=?', [uid]);
  const man = Object.fromEntries((await Q('select provider,data from manual where uid=?', [uid])).map(r => [r.provider, JSON.parse(r.data)]));
  const o = { connected: rows.map(r => NAME[r.provider]), S: {}, Sp: { M: man.spotify?.monthly || 0, F: 0, T: man.spotify?.streams || 0 }, Ap: { P: man.apple?.plays || 0, F: 0, Z: 0 }, proj: [], times: null, errors: {} }, items = [];
  await Promise.all(rows.map(async r => {
    try {
      if (r.provider === 'spotify') { const a = await F.spotify(r.account); o.Sp.F = a.F; o.proj = a.proj; }
      else if (r.provider === 'apple') { const a = await F.apple(r.account); if (!o.proj.length) o.proj = a.proj; }
      else { const d = await F[r.provider](await tok(uid, r.provider)); o.S[NAME[r.provider]] = { F: d.F, L: d.L, V: d.V, x: d.x }; items.push(...(d.items || [])); }
    } catch (e) { o.errors[NAME[r.provider]] = e.message; }
  }));
  if (items.length >= 5) {
    const dv = Array(7).fill(0), dn = Array(7).fill(0), hv = Array(7).fill(0), hn = Array(7).fill(0), hb = [6, 9, 12, 15, 18, 21, 23];
    for (const it of items) { const d = new Date(it.ts - tz * 6e4), wd = (d.getUTCDay() + 6) % 7, h = d.getUTCHours(); let b = 0; for (let i = 0; i < 7; i++) if (Math.abs(hb[i] - h) < Math.abs(hb[b] - h)) b = i; dv[wd] += it.eng; dn[wd]++; hv[b] += it.eng; hn[b]++; }
    const nz = (v, n) => v.map((x, i) => n[i] ? x / n[i] : 0), t = { days: nz(dv, dn), hours: nz(hv, hn) };
    if (Math.max(...t.days) > 0 && Math.max(...t.hours) > 0) o.times = t;
  }
  cache.set(uid, { v: o, e: Date.now() + 3e5 }); s.json(o);
}));

/* ---------- AI engines with live web search ---------- */
const txt = r => r.content.filter(b => b.type === 'text').map(b => b.text).join('');
const ENG = {
  claude: { on: !!E.ANTHROPIC_API_KEY, run: async (p, img, search = true) => txt(await J('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: E.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 2000, ...(search ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}), messages: [{ role: 'user', content: [...(img ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }] : []), { type: 'text', text: p }] }] }) })) },
  openai: { on: !!(E.OPENAI_API_KEY && E.OPENAI_MODEL), run: async p => { const r = await J('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer ' + E.OPENAI_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ model: E.OPENAI_MODEL, tools: [{ type: 'web_search' }], input: p }) }); return (r.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join(''); } },
  gemini: { on: !!E.GEMINI_API_KEY, run: async p => { const r = await J(`https://generativelanguage.googleapis.com/v1beta/models/${E.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': E.GEMINI_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], tools: [{ google_search: {} }] }) }); return (r.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join(''); } },
  grok: { on: !!(E.XAI_API_KEY && E.GROK_MODEL), run: async p => (await J('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + E.XAI_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ model: E.GROK_MODEL, messages: [{ role: 'user', content: p }] }) })).choices[0].message.content }
};
const pj = t => { try { return JSON.parse(t.match(/\{[\s\S]*\}/)[0]); } catch { return null; } };
async function ask(p, img) {
  const on = Object.entries(ENG).filter(([, e]) => e.on);
  if (!on.length) throw new Error('No AI engine keys configured on the server');
  const r = await Promise.allSettled(on.map(async ([n, e]) => ({ engine: n, data: pj(await e.run(p, img)) })));
  r.filter(x => x.status === 'rejected').forEach(x => console.error('AI engine failed:', x.reason?.message));
  const ok = r.filter(x => x.status === 'fulfilled' && x.value.data).map(x => x.value);
  if (!ok.length) throw new Error('AI engines returned nothing usable');
  return ok;
}
const NICHES = ['Fashion', 'Fitness', 'Food', 'Travel', 'Music', 'Comedy', 'Lifestyle'];
const mix = (rs, k, n) => { const L = rs.map(r => r.data?.[k]).filter(Array.isArray), o = []; for (let i = 0; o.length < n && i < 8; i++) for (const l of L) { const x = l[i]; if (x && !o.some(y => JSON.stringify(y) === JSON.stringify(x))) o.push(x); if (o.length >= n) break; } return o; };
app.post('/api/analyze', lim(60, 15), wrap(async (q, s) => {
  const { image, only, exclude = [], title = '', caption = '' } = q.body; let niche = q.body.niche;
  if (!NICHES.includes(niche)) { niche = 'Lifestyle'; if (image && ENG.claude.on) { const j = pj(await ENG.claude.run(`Look at this image. Pick the single best niche from: ${NICHES.join(', ')}. Reply ONLY JSON {"niche":""}`, image, false)); if (NICHES.includes(j?.niche)) niche = j.niche; } }
  const want = { c: '"captions":[4 short captions with strong hooks]', t: '"hashtags":[4 arrays, each with 4 hashtags],"hashtag_popularity":[4 numbers 0-100: how popular each set is right now]', s: '"songs":[4 objects {"title","artist","fit":0-100 how well it fits this post}]', f: '"formats":{"reels":0-100,"posts":0-100,"stories":0-100} (estimated likelihood this niche performs in each format right now)' }, keys = only ? [only] : ['c', 't', 's', 'f'];
  const p = `Today is ${new Date().toDateString()}. You are a short-form social media strategist. Use web search to find what is trending right now on Instagram Reels, TikTok and YouTube Shorts for the "${niche}" niche. Post title: "${title}". Draft caption(s): "${caption}". ${exclude.length ? 'Do not repeat: ' + exclude.slice(0, 20).join('; ') + '.' : ''} Reply with ONLY a JSON object: {${keys.map(k => want[k]).join(',')}}. Only suggest songs and hashtags you actually saw trending.`;
  const rs = await ask(p);
  const tag = x => String(x).startsWith('#') ? x : '#' + x;
  const nums = (k, n) => Array.from({ length: n }, (_, i) => { const v = rs.map(r => +r.data?.[k]?.[i]).filter(x => x >= 0 && x <= 100); return v.length ? Math.round(sum(v) / v.length) : 0; }), fv = k => { const v = rs.map(r => +r.data?.formats?.[k]).filter(x => x >= 0 && x <= 100); return v.length ? Math.round(sum(v) / v.length) : 0; };
  s.json({ niche, hp: nums('hashtag_popularity', 4), f: { Reels: fv('reels'), Posts: fv('posts'), Stories: fv('stories') }, c: mix(rs, 'captions', 4), t: mix(rs, 'hashtags', 4).map(g => g.slice(0, 4).map(tag)), s: mix(rs, 'songs', 4).map(x => Array.isArray(x) ? x : [x.title, x.artist, Math.round(x.fit) || undefined]), engines: rs.map(r => r.engine) });
}));
const score = (rs, f) => { const v = rs.map(r => +r.data?.score).filter(x => x >= 0 && x <= 100); return { score: v.length ? Math.round(sum(v) / v.length) : 0, why: rs.find(r => r.data?.why)?.data.why || '', engines: rs.map(r => r.engine) }; };
app.post('/api/hook', lim(120, 20), wrap(async (q, s) => {
  const { caption = '', niche = 'Lifestyle' } = q.body;
  s.json(score(await ask(`Today is ${new Date().toDateString()}. Rate this caption as a scroll-stopping hook for a ${niche} short-form post on Instagram/TikTok, 0-100, compared with what is trending now. Caption: "${String(caption).slice(0, 300)}". Reply ONLY JSON {"score":0,"why":"one sentence"}`)));
}));
app.post('/api/songfit', lim(60, 15), wrap(async (q, s) => {
  const { song = '', niche = 'Lifestyle', caption = '' } = q.body;
  s.json(score(await ask(`Today is ${new Date().toDateString()}. Use web search. How well does the song "${String(song).slice(0, 120)}" fit a ${niche} Reel/TikTok${caption ? ' with caption "' + String(caption).slice(0, 200) + '"' : ''} right now, considering whether it is currently trending? Score 0-100. Reply ONLY JSON {"score":0,"why":"one sentence"}`)));
}));

app.listen(process.env.PORT || 3000, () => console.log(`CKMETA running on ${BASE}${dev ? ' (dev mode: SMS codes returned in API)' : ''}`));
