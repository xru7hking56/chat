import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme-admin-key';

/* ===== In-memory state ===== */
const waiting = new Set();
const partnerOf = new Map();
const profiles = new Map();
const rate = new Map();

const transcripts = new Map();
const roomOf = new Map();

let reports = [];
let bannedIPs = new Set();

/* ===== Persistence (sync) ===== */
const DATA_DIR = './data';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const PATH_REPORTS = DATA_DIR + '/reports.json';
const PATH_BANS = DATA_DIR + '/bans.json';
function loadJSON(p, fallback){ try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch { return fallback; } }
function saveJSON(p, obj){ try { fs.writeFileSync(p, JSON.stringify(obj,null,2)); } catch(e){ console.error('saveJSON failed', e); } }

reports = loadJSON(PATH_REPORTS, []);
bannedIPs = new Set(loadJSON(PATH_BANS, []));

/* ===== Helpers ===== */
function allowMessage(socketId) {
  const now = Date.now();
  const r = rate.get(socketId) || { count: 0, ts: now };
  if (now - r.ts > 3000) { r.count = 0; r.ts = now; }
  r.count += 1;
  rate.set(socketId, r);
  return r.count <= 6;
}
function sanitize(input){ if (typeof input !== 'string') return ''; return input.replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function onlineCount(){ return io.of('/').sockets.size; }
function emitOnline(){ io.emit('online', onlineCount()); }
function getProfile(id){ if (!profiles.has(id)) profiles.set(id, { gender:'secret', seeking:'any', blocked:new Set() }); return profiles.get(id); }
function areCompatible(aId, bId){
  const a = getProfile(aId), b = getProfile(bId);
  if (a.blocked.has(bId) || b.blocked.has(aId)) return false;
  const aLikesB = a.seeking === 'any' || a.seeking === getProfile(bId).gender;
  const bLikesA = b.seeking === 'any' || b.seeking === getProfile(aId).gender;
  return aLikesB && bLikesA;
}
function ipOf(socket){
  const xf = socket.handshake.headers['x-forwarded-for'];
  const addr = Array.isArray(xf) ? xf[0] : (xf || '');
  const ip = (addr.split(',')[0] || '').trim();
  return ip || socket.handshake.address || 'unknown';
}
function makeRoom(aId, bId){ return `pair:${[aId, bId].sort().join(':')}`; }
function ensureTranscript(roomId){ if (!transcripts.has(roomId)) transcripts.set(roomId, []); return transcripts.get(roomId); }
function appendSystem(roomId, text){ ensureTranscript(roomId).push({ type:'system', text, ts: Date.now() }); }
function appendMessage(roomId, from, text){ ensureTranscript(roomId).push({ type:'message', from, text, ts: Date.now() }); }

function leavePairRooms(socket){
  try{
    for (const room of socket.rooms) {
      if (typeof room === 'string' && room.startsWith('pair:')) {
        socket.leave(room);
      }
    }
  }catch{}
}

/* ===== Matching ===== */
function tryMatch(socket) {
  for (const otherId of waiting) {
    if (otherId === socket.id) continue;
    if (areCompatible(socket.id, otherId)) {
      waiting.delete(otherId);
      waiting.delete(socket.id);
      partnerOf.set(socket.id, otherId);
      partnerOf.set(otherId, socket.id);

      const room = makeRoom(socket.id, otherId);
      const a = socket;
      const b = io.sockets.sockets.get(otherId);

      roomOf.set(a.id, room);
      if (b) roomOf.set(b.id, room);

      a.join(room);
      b?.join(room);

      appendSystem(room, 'paired');

      a.emit('status', { type: 'connected' });
      b?.emit('status', { type: 'connected' });

      io.to(room).emit('system', 'დაკავშირებული ხართ უცნობთან.');
      return true;
    }
  }
  waiting.add(socket.id);
  socket.emit('status', { type: 'searching' });
  return false;
}

function breakPair(id, reason='დაკავშირება შეწყდა.') {
  const partnerId = partnerOf.get(id);
  if (!partnerId) return;
  const a = io.sockets.sockets.get(id);
  const b = io.sockets.sockets.get(partnerId);

  const room = roomOf.get(id);
  if (room) appendSystem(room, 'disconnected');

  partnerOf.delete(id);
  partnerOf.delete(partnerId);

  if (a) { a.emit('status', { type: 'disconnected' }); leavePairRooms(a); roomOf.delete(a.id); }
  if (b) { b.emit('status', { type: 'disconnected' }); leavePairRooms(b); roomOf.delete(b.id); }

  if (a) a.emit('system', reason);
  if (b) b.emit('system', reason);
}

/* ===== Admin API ===== */
function requireAdmin(req, res, next){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token && token === ADMIN_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.get('/admin', (_, res) => res.sendFile(process.cwd() + '/public/admin.html'));
app.get('/admin/api/reports', requireAdmin, (_, res) => res.json({ reports }));
app.post('/admin/api/ban', requireAdmin, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'ip required' });
  bannedIPs.add(String(ip));
  saveJSON(PATH_BANS, Array.from(bannedIPs));
  res.json({ ok: true, banned: Array.from(bannedIPs) });
});
app.get('/admin/api/bans', requireAdmin, (_, res) => res.json({ banned: Array.from(bannedIPs) }));
app.post('/admin/api/resolve', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  const idx = reports.findIndex(r => r.id === id);
  if (idx >= 0) reports.splice(idx, 1);
  saveJSON(PATH_REPORTS, reports);
  res.json({ ok: true });
});
app.get('/healthz', (_, res) => res.json({ ok: true }));

/* ===== Sockets ===== */
io.on('connection', (socket) => {
  const ip = ipOf(socket);
  if (bannedIPs.has(ip)) {
    socket.emit('system', 'თქვენი IP დაბლოკილია.');
    socket.disconnect(true);
    return;
  }

  profiles.set(socket.id, { gender: 'secret', seeking: 'any', blocked: new Set() });
  socket.emit('online', onlineCount());
  emitOnline();

  socket.on('setProfile', ({ gender, seeking }) => {
    const p = getProfile(socket.id);
    if (['male','female','secret'].includes(gender)) p.gender = gender;
    if (['male','female','any'].includes(seeking)) p.seeking = seeking;
  });

  socket.on('connectRequest', () => {
    if (partnerOf.has(socket.id)) return;
    tryMatch(socket);
  });

  socket.on('next', () => {
    if (partnerOf.has(socket.id)) breakPair(socket.id, 'ახალი საუბრის ძიება...');
    tryMatch(socket);
  });

  socket.on('block', () => {
    const partnerId = partnerOf.get(socket.id);
    if (partnerId) {
      getProfile(socket.id).blocked.add(partnerId);
      breakPair(socket.id, 'მომხმარებელი დაიბლოკა.');
      socket.emit('system', 'დაიბლოკა. აღარ დაგაკავშირებთ ამ მომხმარებელთან.');
    } else {
      socket.emit('system', 'მომხმარებელი არ არის დაკავშირებული.');
    }
  });

  socket.on('typing', (isTyping) => {
    const partnerId = partnerOf.get(socket.id);
    if (partnerId) io.to(partnerId).emit('typing', !!isTyping);
  });

  socket.on('message', (text) => {
    if (!allowMessage(socket.id)) {
      socket.emit('system', 'ძალიან სწრაფად გზავნი. სცადე ისევ.');
      return;
    }
    const partnerId = partnerOf.get(socket.id);
    if (!partnerId) {
      socket.emit('system', 'ამჟამად არავინ არის დაკავშირებული.');
      return;
    }
    const clean = sanitize(String(text).slice(0, 2000));
    const room = roomOf.get(socket.id);
    appendMessage(room, 'you', clean);      // single line in transcript
    io.to(partnerId).emit('message', { from: 'stranger', text: clean, ts: Date.now() });
    socket.emit('message', { from: 'you', text: clean, ts: Date.now() });
  });

  socket.on('report', ({ reason, blockNext }) => {
    const partnerId = partnerOf.get(socket.id);
    const room = roomOf.get(socket.id);
    const transcript = (transcripts.get(room) || []).slice(-200);
    const reporterIP = ipOf(socket);
    const reportedIP = partnerId ? ipOf(io.sockets.sockets.get(partnerId)) : 'unknown';
    const submission = {
      id: 'r-' + Math.random().toString(36).slice(2),
      ts: Date.now(),
      roomId: room || null,
      reporterId: socket.id,
      reporterIP,
      reportedId: partnerId || null,
      reportedIP,
      reason: String(reason || '').slice(0, 400),
      transcript
    };
    reports.unshift(submission);
    reports = reports.slice(0, 500);
    saveJSON(PATH_REPORTS, reports);
    socket.emit('system', 'მადლობა. ანგარიში გადაგზავნილია ადმინთან.');

    if (blockNext && partnerId) {
      try { getProfile(socket.id).blocked.add(partnerId); } catch {}
      breakPair(socket.id, 'დაიბლოკა და გადადი შემდეგზე...');
      tryMatch(socket);
    }
  });

  socket.on('disconnect', () => {
    waiting.delete(socket.id);
    if (partnerOf.has(socket.id)) breakPair(socket.id, 'უცნობი გავიდა ჩათიდან.');
    profiles.delete(socket.id);
    rate.delete(socket.id);
    emitOnline();
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
