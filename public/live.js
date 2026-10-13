(() => {
const api = async (u, b) => { const r = await fetch(u, { method: b ? 'POST' : 'GET', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('Error ' + r.status)); return j; };
const PK = { Instagram: 'instagram', TikTok: 'tiktok', YouTube: 'youtube', Spotify: 'spotify', 'Apple Music': 'apple' };
let REAL = null, LIVE = null, ht; const HC = {};
const blank = () => ({ S: { Instagram: { F: 0, L: 0, V: 0, x: { Posts: 0, 'Avg likes': 0, 'Avg reel views': 0, 'Story reach': 0 } }, TikTok: { F: 0, L: 0, V: 0, x: { Videos: 0, 'Avg views': 0, Shares: 0 } }, YouTube: { F: 0, L: 0, V: 0, x: { Videos: 0, 'Avg views': 0, 'Watch hrs': 0 } }, X: { F: 0, L: 0, V: 0, x: { Posts: 0 } } }, Sp: { M: 0, F: 0, T: 0 }, Ap: { P: 0, F: 0, Z: 0 }, proj: [] });
const o = {}; ['profile', 'guess', 'vary', 'hook', 'hk', 'addCap', 'rf', 'apps'].forEach(k => o[k] = window[k]);
window.LIVEON = true;
const tz = () => new Date().getTimezoneOffset();
async function loadReal() { if (AUTH && CON.size && !REAL) { REAL = await api('/api/profile?tz=' + tz()); window.REALT = REAL.times; } }
const refresh = () => { REAL = null; window.REALT = null; $('p4').classList.contains('on') ? profile() : acct(); };

/* ---- real profile data ---- */
window.pd = () => { const b = blank(), r = REAL || {}; Object.assign(b.S, r.S || {}); if (r.Sp) b.Sp = r.Sp; if (r.Ap) b.Ap = r.Ap; if (r.proj) b.proj = r.proj; return b; };
window.profile = () => {
  if (AUTH && CON.size && !REAL) {
    $('prof').innerHTML = cn() + '<div class="card"><p class="sub">Loading your live data…</p></div>';
    loadReal().catch(e => { REAL = { errors: { all: e.message } }; }).then(() => { o.profile(); const er = REAL.errors || {}; if (Object.keys(er).length) $('prof').insertAdjacentHTML('beforeend', '<div class="card"><h2>Some data failed to load</h2>' + Object.entries(er).map(([k, v]) => `<p class="sub">${esc(k)}: ${esc(String(v).slice(0, 160))}</p>`).join('') + '</div>'); });
    return;
  }
  o.profile();
};
window.apps = () => o.apps() + (AUTH && CON.has('Spotify') ? '<button class="cp" style="margin-top:8px" onclick="manual()">Enter Spotify for Artists numbers</button>' : '');
window.manual = async () => { const m = prompt('Monthly listeners (from Spotify for Artists):'); if (m == null) return; const s = prompt('Total streams:'); try { await api('/api/music/manual', { monthly: +m || 0, streams: +s || 0 }); refresh(); } catch (e) { alert(e.message); } };
window.tc = async p => {
  if (!AUTH) return;
  const v = $('hh'); if (v) $('handle').value = v.value;
  try {
    if (CON.has(p)) { await api('/api/disconnect/' + PK[p], {}); CON.delete(p); return refresh(); }
    if (p === 'X') return alert('X is not supported yet.');
    if (p === 'Spotify' || p === 'Apple Music') { const a = prompt(p + ' artist profile link:'); if (!a) return; await api('/api/connect/' + PK[p], { artist: a }); CON.add(p); return refresh(); }
    location.href = '/auth/' + PK[p];
  } catch (e) { alert(e.message); }
};

/* ---- accounts ---- */
window.su = async () => { const u = gv('a1'), p = $('a2').value, ph = gv('a3'); try { const r = await api('/api/signup/start', { username: u, password: p, phone: ph }); A = { m: 'code', ph, code: r.devCode || '' }; acct(); } catch (e) { am('signup', e.message); } };
window.vc = async () => { try { const r = await api('/api/signup/verify', { phone: A.ph, code: gv('a1') }); AUTH = r.user; CON = new Set(); A = { m: 'connect' }; acct(); } catch (e) { am('code', e.message); } };
window.li = async () => { try { const r = await api('/api/login', { username: gv('a1'), password: $('a2').value }); AUTH = r.user; CON = new Set(r.connected); REAL = null; A = { m: 'home' }; acct(); go(1); } catch (e) { am('login', e.message); } };
window.fp = async () => { const u = gv('a1'); try { const r = await api('/api/forgot/start', { username: u }); A = { m: 'reset', u, ph: r.masked, code: r.devCode || '' }; acct(); } catch (e) { am('forgot', e.message); } };
window.rs = async () => { try { await api('/api/forgot/finish', { username: A.u, code: gv('a1'), password: $('a2').value }); am('login', 'Password updated. Log in below.'); } catch (e) { am('reset', e.message); } };
window.out = async () => { await api('/api/logout', {}).catch(() => {}); AUTH = null; CON = new Set(); REAL = null; window.REALT = null; A = { m: 'home' }; acct(); };

/* ---- live AI analysis ---- */
function shrink() { return new Promise(res => { const el = document.querySelector('#dz img,#dz video'); if (!el) return res(null); try { const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight; if (!w) return res(null); const s = Math.min(1, 768 / Math.max(w, h)), c = document.createElement('canvas'); c.width = w * s; c.height = h * s; c.getContext('2d').drawImage(el, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .8).split(',')[1]); } catch { res(null); } }); }
const good = a => Array.isArray(a) && a.some(x => x > 0);
function setLive(r) { LIVE = r; window.LIVEF = r.f && good(Object.values(r.f)) ? r.f : null; window.LIVEHP = good(r.hp) ? r.hp : null; }
window.guess = n => (LIVE && LIVE.niche) || o.guess(n);
window.vary = (d, n) => LIVE && LIVE.niche === n ? { ...d, c: [...LIVE.c, ...d.c].slice(0, 4), t: [...LIVE.t, ...d.t].slice(0, 4), s: [...LIVE.s, ...d.s].slice(0, 4) } : o.vary(d, n);
window.run = async () => {
  if (!media) { $('dz').style.color = '#c00'; $('dz').innerHTML = 'Please upload a photo or video first'; return; }
  go(2); $('res').innerHTML = ''; $('load').style.display = 'block'; $('lt').textContent = 'AI engines are searching the web for trends…';
  try { setLive(await api('/api/analyze', { image: await shrink(), niche: $('niche').value, title: $('title').value, caption: mine.map(m => m.t).join(' | ') || $('cap').value })); }
  catch (e) { LIVE = null; window.LIVEF = window.LIVEHP = null; alert('Live analysis failed: ' + e.message + '\nShowing sample suggestions instead.'); }
  try { await loadReal(); } catch {}
  $('load').style.display = 'none'; show();
  if (LIVE && LIVE.engines) $('res').insertAdjacentHTML('beforeend', `<p class="note">Searched with: ${LIVE.engines.map(esc).join(', ')}</p>`);
};
window.rf = async k => {
  if (!LIVE) return o.rf(k);
  const on = $('p3').classList.contains('on'), d = CTX.d;
  try {
    const ex = k == 'c' ? d.c : k == 't' ? d.t.flat() : d.s.map(x => x[0]);
    const r = await api('/api/analyze', { only: k, niche: CTX.niche, exclude: ex, title: $('title').value });
    if (k == 'c' && r.c.length) LIVE.c = r.c;
    if (k == 't' && r.t.length) { LIVE.t = r.t; if (good(r.hp)) window.LIVEHP = r.hp; }
    if (k == 's' && r.s.length) LIVE.s = r.s;
  } catch (e) { return alert('Refresh failed: ' + e.message); }
  CTX.d = vary(D[CTX.niche], CTX.niche); PV.c = PV.t = PV.s = 0; on ? preview() : show();
};
window.hook = (t, n) => HC[t] ?? o.hook(t, n);
window.hk = () => { o.hk(); clearTimeout(ht); const t = $('cap').value.trim(); if (t.length < 6 || HC[t] != null) return; ht = setTimeout(async () => { try { const r = await api('/api/hook', { caption: t, niche: nich() }); HC[t] = r.score; if ($('cap').value.trim() === t) o.hk(); } catch {} }, 800); };
window.addCap = async () => { const t = $('cap').value.trim(); if (t && HC[t] == null) { try { HC[t] = (await api('/api/hook', { caption: t, niche: nich() })).score; } catch {} } o.addCap(); };
window.addSong = async () => {
  const v = ($('ss').value || '').trim(); if (!v || !CTX) return;
  try { const r = await api('/api/songfit', { song: v, niche: CTX.niche, caption: (mine[0] && mine[0].t) || '' }); const p = v.split(/\s+[-–]\s+/); mySongs.unshift([p[0], p[1] || 'Your music', r.score]); mySongs = mySongs.slice(0, 3); PV.s = 0; preview(); } catch (e) { alert(e.message); }
};

/* ---- boot ---- */
(async () => {
  try { const m = await api('/api/me'); if (m.user) { AUTH = m.user; CON = new Set(m.connected); } } catch {}
  A = { m: 'home' }; acct();
  if (new URLSearchParams(location.search).get('connected')) { history.replaceState({}, '', '/'); go(4); }
})();
})();
