import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { VEHICLES, HOUSES, SPECIAL, PAINTS, PAINT_COST, JOBS, POINTS, START_CASH, MAX_PLAYERS, SPAWN, MODS, RACES, DAILY, FURN, HOME_SLOTS, HOME_MAX, VENUES } from '../shared/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env is optional */ }
const PORT = +process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

/* ------------------------------ persistence ------------------------------ */
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'valley-life.json');
let db = { players: {}, rooms: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = { players: j.players || {}, rooms: j.rooms || {} };
    fs.copyFileSync(DB_FILE, DB_FILE + '.bak'); // only refresh the backup after a successful load
  } catch (e) {
    // Refuse to start rather than overwrite possibly-recoverable data with an empty database.
    console.error(`\nCould not read ${DB_FILE}: ${e.message}\nFix or move that file (a .bak copy may exist) and start again.`);
    process.exit(1);
  }
}
let dirty = false;
const save = () => { dirty = true; };
function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE); // atomic replace
  } catch (e) { dirty = true; console.error('Save failed:', e.message); }
}
setInterval(flush, 3000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });

/* --------------------------------- server -------------------------------- */
const app = express();
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));
app.use(express.static(path.join(ROOT, 'client')));
app.get('/health', (_q, r) => r.json({ ok: true }));
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

const ok = (x = {}) => ({ ok: true, ...x });
const fail = error => ({ ok: false, error });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cleanName = n => String(n || '').replace(/[^\w \-]/g, '').trim().slice(0, 16);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Free cross-restart saving: after every change the server hands the player a signed copy of their save,
// which their browser keeps. If the server's disk is wiped (free hosting), the signed copy restores it.
const SECRET = process.env.SAVE_SECRET || crypto.randomBytes(32).toString('hex');
const sign = (key, p) => crypto.createHmac('sha256', SECRET).update(key + JSON.stringify(p)).digest('hex');
const rooms = new Map();   // active rooms: code -> { code, players: Map(key->me), vehicles: Map(id->veh) }
const online = new Map();  // key -> me

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) { r = { code, players: new Map(), vehicles: new Map() }; rooms.set(code, r); }
  return r;
}
const pub = me => { daily(me); return { name: me.prof.name, cash: me.prof.cash, vehicles: me.prof.vehicles, stats: me.prof.stats, mods: me.prof.mods, tut: !!me.prof.tut, daily: me.prof.daily, home: me.prof.home }; };
const sendProfile = me => { const pr = pub(me); me.prof.t = Date.now(); me.socket.emit('profile', { ...pr, blob: { p: me.prof, sig: sign(me.key, me.prof) } }); };
const notify = (me, text, kind = 'info') => me.socket.emit('notify', { text, kind });

function roomState(room) {
  const houses = {};
  for (const [id, h] of Object.entries(db.rooms[room.code]?.houses || {})) {
    houses[id] = { owner: h.owner.slice(0, 8), ownerName: db.players[h.owner]?.name || '?' };
  }
  return { code: room.code, max: MAX_PLAYERS, players: [...room.players.values()].map(m => ({ id: m.pid, name: m.prof.name, home: m.prof.home })), houses };
}
const broadcastRoom = room => io.to(room.code).emit('room:state', roomState(room));
const vehList = room => [...room.vehicles.values()].map(v => ({ id: v.id, type: v.type, color: v.color, kit: db.players[v.owner]?.mods?.[v.type]?.kit | 0, x: r2(v.x), z: r2(v.z), yaw: r2(v.yaw), owner: v.owner.slice(0, 8), driver: v.driver ? v.driver.slice(0, 8) : null }));
const broadcastVeh = room => io.to(room.code).emit('veh:list', vehList(room));

function despawnVeh(room, me) {
  for (const [id, v] of room.vehicles) {
    if (v.owner === me.key) {
      if (v.driver) { const d = room.players.get(v.driver); if (d) d.driving = null; }
      room.vehicles.delete(id);
    }
  }
  me.driving = null;
  broadcastVeh(room);
}
function joinRoom(me, code) {
  leaveRoom(me);
  const room = getRoom(code), used = new Set([...room.players.values()].map(m => m.prof.home.slot));
  if (me.prof.home.slot < 0 || used.has(me.prof.home.slot)) { me.prof.home.slot = HOME_SLOTS.findIndex((_, i) => !used.has(i)); save(); }
  room.players.set(me.key, me);
  me.room = room; me.active = false; me.hp = 100; me.dmgT = 0; me.pos = { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0 };
  me.socket.join(code);
  broadcastRoom(room);
  me.socket.emit('veh:list', vehList(room));
}
function leaveRoom(me) {
  const room = me.room;
  if (!room) return;
  raceLeave(me);
  despawnVeh(room, me);
  room.players.delete(me.key);
  me.socket.leave(room.code);
  me.room = null; me.active = false; me.job = null; me.driving = null;
  me.socket.emit('job', null);
  if (room.players.size === 0) rooms.delete(room.code); else broadcastRoom(room);
}

/* ---------------------------------- jobs --------------------------------- */
function jobPayload(j) {
  const def = JOBS[j.id];
  const target = j.stage === 'pickup' ? j.pickup : j.dest;
  return { id: j.id, name: def.name, stage: j.stage, target, pay: j.pay, text: j.stage === 'pickup' ? def.pickupText : def.dropText };
}
function startJob(me, id) {
  const def = JOBS[id];
  if (!def || id === 'civilian') { me.job = null; me.socket.emit('job', null); return ok(); }
  const near = POINTS.filter(p => dist(p, me.pos) > 25);
  const pickup = near[Math.floor(Math.random() * near.length)];
  const far = POINTS.filter(p => dist(p, pickup) >= 120);
  const dest = far[Math.floor(Math.random() * far.length)];
  const pay = Math.round(def.base + dist(pickup, dest) * def.perUnit);
  me.job = { id, stage: 'pickup', pickup, dest, pay, t: 0 };
  me.socket.emit('job', jobPayload(me.job));
  return ok();
}

/* ------------------------- daily challenges + races ------------------------ */
function daily(me) { const day = new Date().toISOString().slice(0, 10); if (me.prof.daily.day !== day) me.prof.daily = { day, p: {}, done: {} }; return me.prof.daily; }
function bump(me, id) {
  const d = daily(me), q = DAILY.find(x => x.id === id);
  if (!q || d.done[id]) return;
  d.p[id] = (d.p[id] || 0) + 1;
  if (d.p[id] >= q.goal) { d.done[id] = 1; me.prof.cash += q.reward; me.prof.stats.earned += q.reward; notify(me, `Daily challenge done: ${q.name} (+$${q.reward})`, 'ok'); }
  save(); sendProfile(me);
}
const lobbies = new Map(); // "ROOM:raceId" -> Set(me) waiting in a start zone
const insts = new Map();   // running races
const padOf = id => ({ x: RACES[id].pad[0], z: RACES[id].pad[1] });
function routeLen(def) { let l = 0, p = def.pad; for (const c of def.cps) { l += Math.hypot(c[0] - p[0], c[1] - p[1]); p = c; } return l; }
function tellLobby(set) { for (const m of set) m.socket.emit('race:lobby', { n: set.size }); }
function startRace(id, players, solo) {
  const rid = crypto.randomBytes(4).toString('hex');
  insts.set(rid, { rid, id, solo, startAt: Date.now() + 5000, players: new Map(players.map(m => [m.key, { cp: 0 }])), done: [] });
  for (const m of players) { m.race = rid; m.socket.emit('race:start', { rid, id, solo, ms: 5000 }); }
}
function lobbyLeave(me) { for (const set of lobbies.values()) if (set.delete(me)) tellLobby(set); }
function raceLeave(me) {
  lobbyLeave(me);
  const inst = insts.get(me.race); me.race = null;
  if (inst) { inst.players.delete(me.key); if (!inst.players.size) insts.delete(inst.rid); }
}

/* --------------------------------- sockets ------------------------------- */
io.on('connection', socket => {
  let me = null;
  const handle = (ev, fn, needRoom = true) => socket.on(ev, (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    try {
      if (!me) return cb(fail('Not signed in'));
      if (needRoom && !me.room) return cb(fail('Not in a room'));
      cb(fn(data && typeof data === 'object' ? data : {}) || ok());
    } catch (e) { console.error(ev, e); cb(fail('Server error')); }
  });

  socket.on('hello', (d, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    if (!d || typeof d.token !== 'string' || d.token.length < 16 || d.token.length > 128) return cb(fail('Bad token'));
    const key = sha(d.token);
    const name = cleanName(d.name) || 'Player' + (100 + Math.floor(Math.random() * 900));
    if (me) { me.prof.name = name; save(); if (me.room) broadcastRoom(me.room); return cb(ok({ pid: me.pid, profile: pub(me) })); }
    const old = online.get(key);
    if (old) { leaveRoom(old); old.socket.emit('kicked'); old.socket.disconnect(true); }
    let prof = db.players[key];
    if (d.blob && d.blob.p && d.blob.sig === sign(key, d.blob.p) && (!prof || (d.blob.p.t || 0) > (prof.t || 0))) prof = db.players[key] = d.blob.p; // restore signed save
    if (!prof) prof = db.players[key] = { name, cash: START_CASH, vehicles: { sedan: { color: VEHICLES.sedan.color } }, stats: { earned: 0, spent: 0, jobs: 0 }, created: Date.now() };
    else if (d.name) prof.name = name;
    prof.mods ??= {}; prof.daily ??= { day: '', p: {}, done: {} };
    prof.home ??= { slot: -1, ext: 0xd9a066, wall: 0xe9e2d3, floor: 0xb98b5e, items: [] };
    me = { key, pid: key.slice(0, 8), socket, prof, room: null, active: false, pos: { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0 }, job: null, driving: null, anim: 0 };
    online.set(key, me);
    save();
    cb(ok({ pid: me.pid, profile: { ...pub(me), blob: { p: me.prof, sig: sign(me.key, me.prof) } } }));
  });

  handle('room:create', () => {
    let code;
    do { code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (db.rooms[code]);
    db.rooms[code] = { houses: {}, created: Date.now() };
    save();
    joinRoom(me, code);
    return ok({ code });
  }, false);

  handle('room:join', d => {
    const code = String(d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z2-9]{5}$/.test(code)) return fail('Room codes are 5 letters or numbers.');
    db.rooms[code] ??= { houses: {}, created: Date.now() }; // same code = same room, even after a server restart
    const room = rooms.get(code);
    if (room && room.players.size >= MAX_PLAYERS && !room.players.has(me.key)) return fail('Room is full');
    joinRoom(me, code);
    return ok({ code });
  }, false);

  handle('room:leave', () => { leaveRoom(me); return ok(); }, false);
  handle('play', () => { me.active = true; me.pos = { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0 }; socket.emit('veh:list', vehList(me.room)); });

  // Hot path: unacknowledged position stream from the client.
  socket.on('state', d => {
    if (!me || !me.room || !me.active || !d) return;
    me.pos = { x: num(d.x, me.pos.x), y: num(d.y, 0), z: num(d.z, me.pos.z), yaw: num(d.yaw, 0) };
    me.anim = (d.a | 0) & 3;
    if (me.driving && d.v) {
      const v = me.room.vehicles.get(me.driving);
      if (v && v.driver === me.key) {
        v.x = num(d.v.x, v.x); v.z = num(d.v.z, v.z); v.yaw = num(d.v.yaw, v.yaw);
        v.speed = num(d.v.speed); v.steer = num(d.v.steer); v.brake = d.v.brake ? 1 : 0;
      }
    }
  });

  /* ---- vehicles ---- */
  handle('veh:spawn', d => {
    const room = me.room;
    if (me.driving) return fail('Exit your vehicle first');
    if (!VEHICLES[d.type] || !me.prof.vehicles[d.type]) return fail('You do not own that vehicle');
    despawnVeh(room, me); // one world vehicle per player: no unlimited spawning
    const id = crypto.randomBytes(4).toString('hex');
    room.vehicles.set(id, { id, type: d.type, owner: me.key, color: me.prof.vehicles[d.type].color, x: me.pos.x + Math.sin(me.pos.yaw) * 6, z: me.pos.z + Math.cos(me.pos.yaw) * 6, yaw: me.pos.yaw, driver: null, speed: 0, steer: 0, brake: 0 });
    broadcastVeh(room);
    return ok();
  });
  handle('veh:despawn', () => {
    if ([...me.room.vehicles.values()].some(v => v.owner === me.key && v.driver)) return fail('Exit the vehicle first');
    despawnVeh(me.room, me);
  });
  handle('veh:enter', d => {
    const v = me.room.vehicles.get(String(d.id));
    if (!v) return fail('Vehicle not found');
    if (v.owner !== me.key) return fail('That is not your vehicle');
    if (v.driver || me.driving) return fail('Cannot enter right now');
    if (dist(me.pos, v) > 9) return fail('Too far away');
    v.driver = me.key; me.driving = v.id;
    broadcastVeh(me.room);
  });
  handle('veh:exit', d => {
    const v = me.driving && me.room.vehicles.get(me.driving);
    if (v && v.driver === me.key) { v.driver = null; v.x = num(d.x, v.x); v.z = num(d.z, v.z); v.yaw = num(d.yaw, v.yaw); v.speed = 0; }
    me.driving = null;
    broadcastVeh(me.room);
  });
  handle('veh:paint', d => {
    const own = me.prof.vehicles[d.type];
    if (!own) return fail('You do not own that vehicle');
    if (!PAINTS.includes(d.color)) return fail('Invalid paint');
    if (me.prof.cash < PAINT_COST) return fail('Not enough cash');
    me.prof.cash -= PAINT_COST; me.prof.stats.spent += PAINT_COST; own.color = d.color;
    for (const v of me.room.vehicles.values()) if (v.owner === me.key && v.type === d.type) v.color = d.color;
    save(); sendProfile(me); broadcastVeh(me.room);
    notify(me, 'Repainted for $' + PAINT_COST, 'ok');
  });
  handle('dealer:buy', d => {
    const def = VEHICLES[d.type];
    const shop = SPECIAL.find(s => s.id === 'dealer');
    if (!def || def.price <= 0) return fail('Not for sale');
    if (me.prof.vehicles[d.type]) return fail('You already own this');
    if (dist(me.pos, { x: shop.ix, z: shop.iz }) > 16) return fail('Visit the dealership to buy vehicles');
    if (me.prof.cash < def.price) return fail('Not enough cash');
    me.prof.cash -= def.price; me.prof.stats.spent += def.price;
    me.prof.vehicles[d.type] = { color: def.color };
    save(); sendProfile(me);
    notify(me, `Purchased ${def.name}!`, 'ok');
  });

  /* ---- houses ---- */
  const houseOf = d => HOUSES.find(h => h.id === d.id);
  handle('house:buy', d => {
    const h = houseOf(d); if (!h) return fail('Unknown house');
    const owned = db.rooms[me.room.code].houses;
    if (owned[h.id]) return fail('This house is already owned');
    if (dist(me.pos, { x: h.dx, z: h.dz }) > 12) return fail('Walk up to the front door first');
    if (me.prof.cash < h.price) return fail('Not enough cash');
    me.prof.cash -= h.price; me.prof.stats.spent += h.price;
    owned[h.id] = { owner: me.key, since: Date.now() };
    save(); sendProfile(me); broadcastRoom(me.room);
    io.to(me.room.code).emit('notify', { text: `${me.prof.name} bought ${h.name}!`, kind: 'info' });
  });
  handle('house:sell', d => {
    const h = houseOf(d); if (!h) return fail('Unknown house');
    const owned = db.rooms[me.room.code].houses;
    if (owned[h.id]?.owner !== me.key) return fail('You do not own this house');
    delete owned[h.id];
    const refund = Math.round(h.price * 0.7);
    me.prof.cash += refund; me.prof.stats.earned += refund;
    save(); sendProfile(me); broadcastRoom(me.room);
    notify(me, `Sold for $${refund}`, 'ok');
  });
  handle('house:enter', d => {
    const h = houseOf(d); if (!h) return fail('Unknown house');
    if (!db.rooms[me.room.code].houses[h.id]) return fail('This house is for sale. Buy it to go inside.');
    if (dist(me.pos, { x: h.dx, z: h.dz }) > 12) return fail('Walk up to the front door first');
  });

  /* ---- jobs ---- */
  handle('job:start', d => {
    if (me.job) return fail('Finish or quit your current job first');
    return startJob(me, String(d.id));
  });
  handle('job:cancel', () => { me.job = null; socket.emit('job', null); });
  handle('job:advance', () => {
    const j = me.job; if (!j) return fail('No active job');
    const def = JOBS[j.id];
    const tgt = j.stage === 'pickup' ? j.pickup : j.dest;
    if (dist(me.pos, tgt) > 13) return fail('You are not at the marker yet');
    if (j.stage === 'pickup') {
      if (def.pickupInVehicle && !me.driving) return fail('Pull up in a vehicle');
      j.stage = 'dropoff'; j.t = Date.now();
      socket.emit('job', jobPayload(j));
      notify(me, 'Picked up! Head to the drop-off.', 'ok');
      return ok();
    }
    if (!me.driving) return fail('Drive to the drop-off in a vehicle');
    const minMs = (dist(j.pickup, j.dest) / 80) * 1000; // faster than any vehicle can legitimately travel
    if (Date.now() - j.t < minMs) return fail('Completed too fast. Drive there!');
    me.prof.cash += j.pay; me.prof.stats.earned += j.pay; me.prof.stats.jobs++; bump(me, 'jobs');
    me.job = null;
    save(); sendProfile(me);
    socket.emit('job', null);
    notify(me, `${def.name} job complete: +$${j.pay}`, 'ok');
    socket.to(me.room.code).emit('notify', { text: `${me.prof.name} finished a ${def.name} job (+$${j.pay})`, kind: 'info' });
  });

  /* ---- races ---- */
  handle('race:ready', d => {
    const def = RACES[d.id];
    if (!def) return fail('Unknown race');
    if (me.race) return fail('You are already racing');
    if (!me.driving) return fail('Drive into the zone in a car');
    if (dist(me.pos, padOf(d.id)) > 16) return fail('Drive into the glowing zone');
    if (d.solo) { lobbyLeave(me); startRace(d.id, [me], true); return ok(); }
    const k = me.room.code + ':' + d.id, set = lobbies.get(k) || new Set();
    lobbies.set(k, set); set.add(me);
    if (set.size >= 2) { lobbies.delete(k); startRace(d.id, [...set], false); } else tellLobby(set);
  });
  handle('race:unready', () => { lobbyLeave(me); });
  handle('race:quit', () => { raceLeave(me); });
  handle('race:cp', d => {
    const inst = insts.get(d.rid), p = inst?.players.get(me.key);
    if (!p) return fail('Not racing');
    const def = RACES[inst.id];
    if (Date.now() < inst.startAt - 300 || d.i !== p.cp) return fail('Bad checkpoint');
    const c = def.cps[p.cp];
    if (dist(me.pos, { x: c[0], z: c[1] }) > 26) return fail('Too far from the checkpoint');
    if (++p.cp < def.cps.length) return ok();
    const ms = Date.now() - inst.startAt;
    if (ms / 1000 < routeLen(def) / 100) { p.cp--; return fail('Finished too fast'); }
    const place = inst.done.length; inst.done.push(me.key);
    let pay = inst.solo ? def.solo : def.pay[place] || 0;
    if (def.reward && !me.prof.tut) { me.prof.tut = true; pay = def.reward; }
    me.prof.cash += pay; me.prof.stats.earned += pay;
    bump(me, 'races'); if (!inst.solo && place === 0) bump(me, 'wins');
    inst.players.delete(me.key); me.race = null; if (!inst.players.size) insts.delete(inst.rid);
    save(); sendProfile(me);
    socket.emit('race:done', { place, pay, solo: inst.solo, ms });
    if (!inst.solo) socket.to(me.room.code).emit('notify', { text: `${me.prof.name} finished #${place + 1} in the ${def.name}`, kind: 'info' });
  });
  handle('shop:buy', d => {
    const m = MODS[d.stat], own = me.prof.vehicles[d.type], shop = SPECIAL.find(s => s.id === 'mechanic');
    if (!m || !own) return fail('Unknown upgrade');
    if (dist(me.pos, { x: shop.ix, z: shop.iz }) > 16) return fail("Visit Brad's Shop to upgrade");
    const mods = (me.prof.mods[d.type] ??= {}), lv = mods[d.stat] | 0;
    if (lv >= m.max) return fail('Already maxed');
    if (me.prof.cash < m.price[lv]) return fail('Not enough cash');
    me.prof.cash -= m.price[lv]; me.prof.stats.spent += m.price[lv]; mods[d.stat] = lv + 1;
    save(); sendProfile(me);
    if (d.stat === 'kit') broadcastVeh(me.room);
    notify(me, `${m.name}: level ${lv + 1}`, 'ok');
  });

  /* ---- homes, store, venues, fighting ---- */
  handle('mart:buy', d => {
    const f = FURN[d.id], h = me.prof.home, shop = SPECIAL.find(s => s.id === 'mart');
    if (!f) return fail('Unknown item');
    if (dist(me.pos, { x: shop.ix, z: shop.iz }) > 16) return fail('Visit Valley Life Mart');
    if (h.items.length >= HOME_MAX) return fail('Your house is full. Sell something first.');
    if (me.prof.cash < f.price) return fail('Not enough cash');
    me.prof.cash -= f.price; me.prof.stats.spent += f.price; h.items.push(d.id);
    save(); sendProfile(me); broadcastRoom(me.room); notify(me, `${f.name} delivered to your house`, 'ok');
  });
  handle('home:remove', d => {
    const h = me.prof.home, id = h.items[d.i | 0];
    if (!id) return fail('No such item');
    h.items.splice(d.i | 0, 1); const r = Math.floor(FURN[id].price / 2); me.prof.cash += r;
    save(); sendProfile(me); broadcastRoom(me.room); notify(me, `Sold for $${r}`, 'ok');
  });
  handle('home:color', d => {
    if (!['ext', 'wall', 'floor'].includes(d.part) || !PAINTS.includes(d.color)) return fail('Invalid colour');
    me.prof.home[d.part] = d.color; save(); sendProfile(me); broadcastRoom(me.room);
  });
  handle('venue:buy', d => {
    const sp = SPECIAL.find(s => s.id === d.v), it = VENUES[d.v]?.items[d.i | 0];
    if (!it) return fail('Unknown item');
    if (dist(me.pos, { x: sp.ix, z: sp.iz }) > 16) return fail('Walk up to the counter');
    if (me.prof.cash < it[1]) return fail('Not enough cash');
    me.prof.cash -= it[1]; me.prof.stats.spent += it[1]; me.hp = Math.min(100, me.hp + it[2]);
    save(); sendProfile(me); socket.emit('hp', { hp: me.hp, show: true }); notify(me, `Enjoy your ${it[0]}!`, 'ok');
  });
  handle('fight:punch', () => {
    const now = Date.now();
    if (now - (me.punchT || 0) < 450) return fail('cooldown');
    me.punchT = now;
    let tgt = null, best = 3.2;
    if (!me.driving) for (const m of me.room.players.values()) if (m !== me && m.active && !m.driving) { const dd = dist(me.pos, m.pos); if (dd < best) { best = dd; tgt = m; } }
    io.to(me.room.code).emit('fight:fx', { pid: me.pid, hit: !!tgt });
    if (tgt) {
      tgt.hp -= 10; tgt.dmgT = now;
      if (tgt.hp <= 0) {
        tgt.hp = 100; tgt.socket.emit('respawn'); notify(tgt, 'You were knocked out. Waking up at home.');
        io.to(me.room.code).emit('notify', { text: `${me.prof.name} knocked out ${tgt.prof.name}`, kind: 'info' });
      }
      tgt.socket.emit('hp', { hp: tgt.hp, show: true });
    }
    socket.emit('hp', { hp: me.hp, show: true });
  });

  socket.on('disconnect', () => {
    if (!me) return;
    leaveRoom(me);
    if (online.get(me.key) === me) online.delete(me.key);
    flush();
  });
});

// 15 Hz world snapshots, one per room.
setInterval(() => {
  for (const room of rooms.values()) {
    const p = {}, v = {};
    for (const m of room.players.values()) if (m.active) p[m.pid] = [r1(m.pos.x), r1(m.pos.y), r1(m.pos.z), r2(m.pos.yaw), m.anim, m.driving ? 1 : 0];
    for (const x of room.vehicles.values()) if (x.driver) v[x.id] = [r2(x.x), r2(x.z), r2(x.yaw), r1(x.speed || 0), r2(x.steer || 0), x.brake || 0];
    io.to(room.code).emit('snap', { p, v });
  }
}, 66);

setInterval(() => { for (const m of online.values()) if (m.room && m.hp < 100 && Date.now() - m.dmgT > 3000) { m.hp = Math.min(100, m.hp + 5); m.socket.emit('hp', { hp: m.hp, show: false }); } }, 1000); // health regen

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nValley Life server running.\n  This computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Same Wi-Fi/LAN: http://${i.address}:${PORT}`);
  console.log(`  Data file:      ${DB_FILE}\n`);
});
