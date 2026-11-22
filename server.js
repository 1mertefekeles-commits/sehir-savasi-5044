const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('index.html bulunamadi'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const players = new Map();
let nextId = 1;

const MAP = 90;
const rand = (a, b) => a + Math.random() * (b - a);
const spawnPoint = () => ({ x: rand(-MAP / 2, MAP / 2), z: rand(-MAP / 2, MAP / 2) });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj) { const s = JSON.stringify(obj); wss.clients.forEach(c => c.readyState === 1 && c.send(s)); }

wss.on('connection', (ws) => {
  const id = nextId++;
  const sp = spawnPoint();
  const p = { id, name: 'Oyuncu' + id, x: sp.x, z: sp.z, r: 0, hp: 100, score: 0, dead: false, lastShot: 0 };
  players.set(id, p);
  send(ws, { t: 'welcome', id, x: p.x, z: p.z });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && typeof m.name === 'string') {
      p.name = m.name.slice(0, 12) || p.name;
    } else if (m.t === 'state' && !p.dead) {
      if (Number.isFinite(m.x) && Number.isFinite(m.z) && Number.isFinite(m.r)) {
        p.x = Math.max(-MAP, Math.min(MAP, m.x));
        p.z = Math.max(-MAP, Math.min(MAP, m.z));
        p.r = m.r;
      }
    } else if (m.t === 'shoot' && !p.dead) {
      const now = Date.now();
      if (now - p.lastShot < 250) return;
      p.lastShot = now;
      const dx = Math.sin(p.r), dz = Math.cos(p.r);
      let hitId = null, best = 45;
      for (const q of players.values()) {
        if (q.id === p.id || q.dead) continue;
        const vx = q.x - p.x, vz = q.z - p.z;
        const along = vx * dx + vz * dz;
        if (along < 0 || along > best) continue;
        const perp = Math.abs(vx * dz - vz * dx);
        if (perp < 1.1) { best = along; hitId = q.id; }
      }
      if (hitId) {
        const q = players.get(hitId);
        q.hp -= 20;
        if (q.hp <= 0) {
          q.dead = true; q.hp = 0; p.score++;
          setTimeout(() => {
            const s = spawnPoint();
            q.x = s.x; q.z = s.z; q.hp = 100; q.dead = false;
            const target = [...wss.clients].find(c => c.pid === q.id);
            if (target) send(target, { t: 'respawn', x: q.x, z: q.z });
          }, 3000);
        }
      }
      broadcast({ t: 'shot', id: p.id, x: p.x, z: p.z, r: p.r, len: best, hit: !!hitId });
    }
  });
  ws.pid = id;
  ws.on('close', () => { players.delete(id); });
});

setInterval(() => {
  broadcast({
    t: 'snap',
    players: [...players.values()].map(p => ({
      id: p.id, name: p.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2),
      r: +p.r.toFixed(2), hp: p.hp, score: p.score, dead: p.dead
    }))
  });
}, 66);

server.listen(PORT, () => console.log('Sunucu calisiyor: ' + PORT));
