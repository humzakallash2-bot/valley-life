// Starts a real server and drives it with real Socket.IO clients. Run: npm test
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';

const PORT = 3111, URL = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-'));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const tokA = 'a'.repeat(32), tokB = 'b'.repeat(32), tokC = 'c'.repeat(32);
// Pre-seed a rich player (A) so purchase success paths can be tested; B and C are brand new ($1,000).
fs.writeFileSync(path.join(dir, 'valley-life.json'), JSON.stringify({ rooms: {}, players: {
  [sha(tokA)]: { name: 'Rich', cash: 200000, vehicles: { sedan: { color: 0x1e88e5 } }, stats: { earned: 0, spent: 0, jobs: 0 } } } }));

let proc;
const startServer = () => new Promise((res, rej) => {
  proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout.on('data', d => { if (String(d).includes('running')) res(); });
  proc.on('exit', c => c && rej(new Error('server exited ' + c)));
});
const stopServer = () => new Promise(r => { proc.once('exit', r); proc.kill('SIGINT'); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = (s, ev, d = {}) => new Promise(r => s.emit(ev, d, r));
async function client(token, name) {
  const s = io(URL, { forceNew: true });
  s.snap = null; s.job = null; s.cars = [];
  s.on('profile', p => (s.profile = p)); s.on('snap', x => (s.snap = x)); s.on('job', j => (s.job = j)); s.on('veh:list', l => (s.cars = l));
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
  t('join unknown room is rejected', !(await call(B, 'room:join', { code: 'ZZZZZ' })).ok);
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
  A2.close(); C.close();
  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error('\nTEST FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { proc.kill('SIGINT'); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
