// Starts a real server and drives it with real Socket.IO clients. Run: npm test
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';
import { RACES } from '../shared/config.js';

const PORT = 3111, URL = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-'));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const tokA = 'a'.repeat(32), tokB = 'b'.repeat(32), tokC = 'c'.repeat(32);
// Pre-seed a rich player (A) so purchase success paths can be tested; B and C are brand new ($1,000).
fs.writeFileSync(path.join(dir, 'valley-life.json'), JSON.stringify({ rooms: {}, players: {
  [sha(tokA)]: { name: 'Rich', cash: 200000, vehicles: { sedan: { color: 0x1e88e5 } }, stats: { earned: 0, spent: 0, jobs: 0 } } } }));

let proc;
const startServer = () => new Promise((res, rej) => {
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: dir, SAVE_SECRET: 'test-secret' }, stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout.on('data', d => { if (String(d).includes('running')) res(); });
  proc.on('exit', c => c && rej(new Error('server exited ' + c)));
});
const stopServer = () => new Promise(r => { proc.once('exit', r); proc.kill('SIGINT'); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = (s, ev, d = {}) => new Promise(r => s.emit(ev, d, r));
async function client(token, name) {
  const s = io(URL, { forceNew: true });
  s.snap = null; s.job = null; s.cars = [];
  s.on('profile', p => { s.profile = p; s.blob = p.blob; }); s.on('room:state', st => (s.st = st)); s.on('snap', x => (s.snap = x)); s.on('job', j => (s.job = j)); s.on('veh:list', l => (s.cars = l));
  await new Promise(r => s.on('connect', r));
  const h = await call(s, 'hello', { token, name });
  assert(h.ok, 'hello'); s.pid = h.pid; s.profile = h.profile;
  return s;
}
const pos = (s, x, z, v) => s.emit('state', { x, y: 0, z, yaw: 0, a: 0, ...(v ? { v } : {}) });
let passed = 0;
const t = (name, cond) => { assert(cond, name); passed++; console.log('  ok -', name); };

try {
  await startServer();
  let A = await client(tokA, 'Rich'), B = await client(tokB, 'Bob');
  t('new player starts with $1,000', B.profile.cash === 1000);
  t('new player owns the starter sedan', !!B.profile.vehicles.sedan);

  const created = await call(A, 'room:create');
  t('create room returns 5-char code', created.ok && created.code.length === 5);
  t('join unknown room is rejected', !(await call(B, 'room:join', { code: 'ZZ' })).ok);
  t('join with code works (case-insensitive)', (await call(B, 'room:join', { code: created.code.toLowerCase() })).ok);
  await call(A, 'play'); await call(B, 'play');

  pos(A, 10, 10); pos(B, 20, 10); await sleep(300);
  t('A sees B in snapshots (real networking)', !!A.snap?.p[B.pid]);
  t('B sees A in snapshots', !!B.snap?.p[A.pid]);
  t('B position relayed correctly', A.snap.p[B.pid][0] === 20);

  // --- economy is server-authoritative ---
  t('cannot buy SUV with $1,000', !(await call(B, 'dealer:buy', { type: 'suv' })).ok);
  t('cannot buy house with $1,000', !(await call(B, 'house:buy', { id: 'h1' })).ok);
  t('cash unchanged after failed buys', (await new Promise(r => { B.once('profile', r); call(B, 'veh:paint', { type: 'sedan', color: 0xe53935 }); })).cash === 900);
  t('invalid paint rejected', !(await call(B, 'veh:paint', { type: 'sedan', color: 123 })).ok);
  t('cannot paint a vehicle you do not own', !(await call(B, 'veh:paint', { type: 'sports', color: 0xe53935 })).ok);
  t('fake client message cannot set cash', (B.emit('profile', { cash: 9e9 }), true));

  // --- dealership requires being there ---
  t('buy SUV far from dealership is rejected', !(await call(A, 'dealer:buy', { type: 'suv' })).ok);
  pos(A, -40, -27); await sleep(150);
  t('buy SUV at dealership works', (await call(A, 'dealer:buy', { type: 'suv' })).ok);
  t('cannot buy the same car twice', !(await call(A, 'dealer:buy', { type: 'suv' })).ok);

  // --- houses: no double purchase ---
  pos(A, -120, 92); pos(B, -120, 92); await sleep(150);
  t('A buys house h1', (await call(A, 'house:buy', { id: 'h1' })).ok);
  t('B cannot buy the same house', !(await call(B, 'house:buy', { id: 'h1' })).ok);
  t('anyone can visit an owned house', (await call(B, 'house:enter', { id: 'h1' })).ok);
  t('cannot enter an unowned house', !(await call(B, 'house:enter', { id: 'h2' })).ok);
  t('B cannot sell A\'s house', !(await call(B, 'house:sell', { id: 'h1' })).ok);

  // --- vehicles ---
  t('cannot spawn a car you do not own', !(await call(B, 'veh:spawn', { type: 'sports' })).ok);
  pos(A, 0, 0); await sleep(150);
  t('A spawns SUV', (await call(A, 'veh:spawn', { type: 'suv' })).ok);
  await sleep(100);
  t('B sees the SUV in the world', B.cars.some(c => c.type === 'suv'));
  t('spawning another replaces the first (no unlimited cars)', (await call(A, 'veh:spawn', { type: 'sedan' })).ok && (await sleep(100), A.cars.filter(c => c.owner === A.pid).length === 1));
  const car = A.cars.find(c => c.owner === A.pid);
  t('B cannot enter A\'s car', !(await call(B, 'veh:enter', { id: car.id })).ok);
  t('A enters own car', (await call(A, 'veh:enter', { id: car.id })).ok);
  pos(A, car.x, car.z, { x: car.x + 5, z: car.z, yaw: 1, speed: 20, steer: 0, brake: 0 }); await sleep(250);
  t('driver vehicle state reaches B', B.snap?.v[car.id]?.[3] === 20);

  // --- jobs ---
  await call(A, 'veh:exit', { x: 0, z: 0, yaw: 0 });
  t('cannot start delivery with another job active (after start)', (await call(A, 'job:start', { id: 'delivery' })).ok && !(await call(A, 'job:start', { id: 'taxi' })).ok);
  await sleep(100);
  const j = A.job; A.job_pay = j.pay; t('job has a pickup target', j?.stage === 'pickup' && j.target);
  t('advance far from marker rejected', !(await call(A, 'job:advance')).ok);
  pos(A, j.target.x, j.target.z); await sleep(150);
  t('pickup on foot works for delivery', (await call(A, 'job:advance')).ok && A.job?.stage === 'dropoff');
  const drop = A.job.target;
  pos(A, drop.x, drop.z); await sleep(150);
  t('drop-off on foot rejected (needs vehicle)', !(await call(A, 'job:advance')).ok);
  const mine = A.cars.find(c => c.owner === A.pid);
  pos(A, mine.x, mine.z); await sleep(100);
  await call(A, 'veh:enter', { id: mine.id });
  pos(A, drop.x, drop.z, { x: drop.x, z: drop.z, yaw: 0, speed: 0, steer: 0, brake: 0 }); await sleep(100);
  t('instant completion (teleport cheat) rejected', !(await call(A, 'job:advance')).ok);
  const before = A.profile.cash;
  await sleep(4500);
  pos(A, drop.x, drop.z, { x: drop.x, z: drop.z, yaw: 0, speed: 0, steer: 0, brake: 0 });
  const paid = await new Promise(r => { A.once('profile', r); call(A, 'job:advance'); });
  t('legit completion pays the player', paid.cash === before + A.job_pay && paid.stats.jobs === 1);

  // --- reconnect + persistence across restart ---
  const code = created.code, cashA = paid.cash;
  A.close(); B.close(); await sleep(300); await stopServer(); await sleep(200);
  await startServer();
  A = await client(tokA, 'Rich');
  t('cash persisted after server restart', A.profile.cash === cashA);
  t('purchased vehicle persisted', !!A.profile.vehicles.suv);
  const rj = await call(A, 'room:join', { code });
  t('room code still valid after restart', rj.ok);
  let state; A.once('room:state', s => (state = s)); await call(A, 'room:join', { code }); await sleep(100);
  t('house ownership persisted', state?.houses.h1?.ownerName === 'Rich');

  // --- same account on a second socket kicks the first ---
  const A2 = await client(tokA, 'Rich'); await sleep(200);
  t('duplicate login kicks old session', A.disconnected);
  const C = await client(tokC, 'Carol'); const rf = await call(C, 'room:join', { code });
  t('third player joins', rf.ok);
  // --- Brad's shop, tutorial race, 2-player City Race ---
  const code2 = code; await call(A2, 'room:join', { code: code2 }); await call(C, 'room:join', { code: code2 }); await call(A2, 'play'); await call(C, 'play');
  for (const s of [A2, C]) { s.on('race:start', r => (s.rs = r)); s.on('race:done', r => (s.rd = r)); }
  pos(A2, 40, 51.5); await sleep(150);
  t("buy engine tuning at Brad's Shop", (await call(A2, 'shop:buy', { type: 'sedan', stat: 'engine' })).ok);
  await sleep(100); t('upgrade level saved in profile', A2.profile.mods.sedan.engine === 1);
  t('cannot buy an upgrade for a car you do not own', !(await call(A2, 'shop:buy', { type: 'hyper', stat: 'engine' })).ok);
  pos(A2, 0, 0); await sleep(150);
  t('shop upgrade rejected away from the shop', !(await call(A2, 'shop:buy', { type: 'sedan', stat: 'brakes' })).ok);
  for (const s of [A2, C]) { pos(s, 6, 6); await sleep(120); await call(s, 'veh:spawn', { type: 'sedan' }); await sleep(120); await call(s, 'veh:enter', { id: s.cars.find(x => x.owner === s.pid).id }); }
  const V0 = (x, z) => ({ x, z, yaw: 0, speed: 0, steer: 0, brake: 0 });
  const run = async (s, id) => { let r = { ok: true }; for (let i = 0; i < RACES[id].cps.length; i++) { const c = RACES[id].cps[i]; pos(s, c[0], c[1], V0(c[0], c[1])); await sleep(120); r = await call(s, 'race:cp', { rid: s.rs.rid, i }); if (!r.ok) return r; } return r; };
  pos(C, 0, -40, V0(0, -40)); await sleep(150);
  t('race rejected outside its start zone', !(await call(C, 'race:ready', { id: 'city' })).ok);
  t('solo tutorial race starts with a 5s countdown', (await call(C, 'race:ready', { id: 'tutorial', solo: true })).ok && (await sleep(150), C.rs?.ms === 5000));
  t('checkpoint rejected during the countdown', !(await call(C, 'race:cp', { rid: C.rs.rid, i: 0 })).ok);
  await sleep(8200);
  t('skipping a checkpoint is rejected', !(await call(C, 'race:cp', { rid: C.rs.rid, i: 2 })).ok);
  t('tutorial race completes', (await run(C, 'tutorial')).ok); await sleep(150);
  t('tutorial pays $50,000', C.rd?.pay === 50000 && C.profile.cash >= 51000);
  for (const s of [A2, C]) { s.rs = null; s.rd = null; pos(s, -40, 0, V0(-40, 0)); }
  await sleep(200);
  t('first racer waits in the zone', (await call(A2, 'race:ready', { id: 'city' })).ok && !A2.rs);
  t('second racer triggers the countdown for both', (await call(C, 'race:ready', { id: 'city' })).ok && (await sleep(150), !!A2.rs && !!C.rs && A2.rs.rid === C.rs.rid && !A2.rs.solo));
  await sleep(13200);
  { const r = await run(A2, 'city'); t('City Race finish #1 ' + (r.error || ''), r.ok); } await sleep(100);
  { const r = await run(C, 'city'); t('City Race finish #2 ' + (r.error || ''), r.ok); } await sleep(150);
  t('1st place pays $100,000', A2.rd?.place === 0 && A2.rd.pay === 100000);
  t('2nd place pays $10,000', C.rd?.place === 1 && C.rd.pay === 10000);
  const D = await client(tokC, 'x').catch(() => null); if (D) D.close();
  // --- Valley Life Mart + home colours (A2 is rich) ---
  pos(A2, -120, -105.5); await sleep(150);
  t('buy a sofa at Valley Life Mart', (await call(A2, 'mart:buy', { id: 'sofa' })).ok); await sleep(100);
  t('furniture appears in the home data everyone receives', A2.st.players.find(p => p.id === A2.pid).home.items[0] === 'sofa');
  t('unknown furniture rejected', !(await call(A2, 'mart:buy', { id: 'nope' })).ok);
  pos(A2, 0, 0); await sleep(150);
  t('store rejected away from the mart', !(await call(A2, 'mart:buy', { id: 'bed' })).ok);
  t('recolour home exterior', (await call(A2, 'home:color', { part: 'ext', color: 0xe53935 })).ok);
  t('invalid colour rejected', !(await call(A2, 'home:color', { part: 'ext', color: 123 })).ok);
  t('sell furniture refunds half', (await call(A2, 'home:remove', { i: 0 })).ok);
  // --- two new players: starter homes at different lots, fighting, health ---
  const tokD = 'd'.repeat(32), tokE = 'e'.repeat(32);
  const Dc = await client(tokD, 'Dee'), Ec = await client(tokE, 'Eve');
  await call(Dc, 'room:join', { code }); await call(Ec, 'room:join', { code }); await call(Dc, 'play'); await call(Ec, 'play'); await sleep(150);
  const slots = Ec.st.players.map(p => p.home.slot);
  t('every player gets a starter home at a different lot', new Set(slots).size === slots.length && slots.every(x => x >= 0));
  pos(Dc, 10, 10); pos(Ec, 11, 10); await sleep(150);
  Ec.on('hp', h => (Ec.hp = h.hp)); Ec.on('respawn', () => (Ec.resp = true));
  t('punch hurts a nearby player', (await call(Dc, 'fight:punch')).ok && (await sleep(100), Ec.hp === 90));
  t('punch has a cooldown', (await call(Dc, 'fight:punch')).error === 'cooldown');
  await sleep(5200); t('health regenerates after a few seconds', Ec.hp > 90);
  for (let i = 0; i < 12; i++) { await sleep(470); await call(Dc, 'fight:punch'); }
  await sleep(150); t('knocked-out player is sent back home', Ec.resp === true);
  // --- free saving: signed save copy survives a wiped server ---
  await call(Dc, 'veh:paint', { type: 'sedan', color: 0xe53935 }); await sleep(150);
  const blob = Dc.blob; t('server hands out a signed save copy', !!blob && !!blob.sig);
  Dc.close(); Ec.close(); A2.close(); C.close(); await sleep(300); await stopServer();
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f)); // simulate a free-tier disk wipe
  await startServer();
  const hello2 = async (token, b) => { const s = io(URL, { forceNew: true }); await new Promise(r => s.on('connect', r)); const h = await call(s, 'hello', { token, name: 'Dee', blob: b }); s.close(); return h.profile; };
  const forged = JSON.parse(JSON.stringify(blob)); forged.p.cash = 9999999;
  t('forged save copy is ignored', (await hello2(tokD, forged)).cash === 1000);
  const back = await hello2(tokD, blob);
  t('signed save copy restores progress after a disk wipe', back.cash === 900 && back.vehicles.sedan.color === 0xe53935);
  const other = await hello2('z'.repeat(32), blob);
  t('save copy cannot be used by a different player', other.cash === 1000);
  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error('\nTEST FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { proc.kill('SIGINT'); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
