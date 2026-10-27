import * as THREE from 'three';
import { VEHICLES, HOUSES, SPECIAL, PAINTS, PAINT_COST, JOBS, SPAWN, ROAD } from '/shared/config.js';
import { buildWorld, buildInterior, makeLabel } from './world.js';
import { makeCar, setCarState, VehicleSim, resolveCircle } from './vehicle.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angLerp = (a, b, t) => a + ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * t;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');

const S = { pid: null, profile: null, room: null, players: [], houses: {}, inGame: false, job: null, vehicles: new Map(), remote: new Map(),
  mode: 'foot', myVeh: null, sim: null, panel: null, interior: null, houseSel: null, head: false, brake: false, advancing: false, lastAdv: 0, sens: 1 };

/* ------------------------------ renderer/scene ------------------------------ */
const renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xbfd9f2, 120, 520);
const camera = new THREE.PerspectiveCamera(65, 1, 0.3, 900);
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x445533, 0.7);
const sun = new THREE.DirectionalLight(0xfff2d6, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 500 });
scene.add(hemi, sun, sun.target);
const roomLight = new THREE.PointLight(0xffe6c0, 60, 40, 2); roomLight.visible = false; scene.add(roomLight);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const world = buildWorld(scene), colliders = world.colliders;
const interiors = HOUSES.map((h, i) => buildInterior(scene, i, colliders));
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 80, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
beam.visible = false; scene.add(beam);

const NIGHT = new THREE.Color(0x0b1226), DAY = new THREE.Color(0x8ec5f0), tmpC = new THREE.Color();
let dayK = 1;
function updateSky(me) {
  const tod = ((Date.now() / 1000 / 720) + 0.4) % 1, ang = (tod - 0.25) * Math.PI * 2, s = Math.sin(ang);
  dayK = clamp(s * 2 + 0.3, 0, 1);
  tmpC.copy(NIGHT).lerp(DAY, dayK); scene.background = tmpC.clone(); scene.fog.color.copy(tmpC);
  sun.intensity = Math.max(0, s) * 2.4 + 0.05; hemi.intensity = 0.25 + 0.5 * dayK;
  sun.target.position.set(me.x, 0, me.z); sun.position.set(me.x + Math.cos(ang) * 150, Math.max(20, s * 160), me.z + 60);
  world.lampMat.emissiveIntensity = dayK < 0.5 ? 3 : 0;
}
const isNight = () => dayK < 0.5;

/* ---------------------------------- audio ---------------------------------- */
const AU = { ctx: null, vol: 0.6, engine: null, amb: null };
function audioInit() {
  if (AU.ctx) return;
  const ctx = AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator(); osc.type = 'sawtooth';
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
  const g = ctx.createGain(); g.gain.value = 0; osc.connect(f).connect(g).connect(ctx.destination); osc.start();
  AU.engine = { osc, g, f };
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 350;
  const ag = ctx.createGain(); ag.gain.value = 0.02 * AU.vol; src.connect(bp).connect(ag).connect(ctx.destination); src.start(); AU.amb = ag;
}
function beep(freq = 600, dur = 0.08, type = 'sine', vol = 0.15, delay = 0) {
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime + delay, o = AU.ctx.createOscillator(), g = AU.ctx.createGain();
  o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol * AU.vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AU.ctx.destination); o.start(t); o.stop(t + dur);
}
const sfx = k => ({ click: () => beep(520, 0.05), ok: () => { beep(660, 0.08); beep(880, 0.12, 'sine', 0.15, 0.08); }, cash: () => { beep(988, 0.07, 'triangle'); beep(1318, 0.18, 'triangle', 0.15, 0.07); }, err: () => beep(160, 0.18, 'square', 0.12), crash: () => beep(80, 0.25, 'sawtooth', 0.3) }[k]?.());
function engineAudio(ratio, thr, on) {
  if (!AU.engine) return; const t = AU.ctx.currentTime, { osc, g, f } = AU.engine;
  osc.frequency.setTargetAtTime(45 + ratio * 150 + thr * 25, t, 0.08); f.frequency.setTargetAtTime(300 + ratio * 900, t, 0.1);
  g.gain.setTargetAtTime(on ? AU.vol * 0.05 * (0.5 + thr * 0.5) : 0, t, 0.1);
}

/* --------------------------------- people ---------------------------------- */
function hueColor(id) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360; return new THREE.Color().setHSL(h / 360, 0.6, 0.5); }
function makePerson(color, name) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color }), skin = new THREE.MeshStandardMaterial({ color: 0xf1c9a5 }), dark = new THREE.MeshStandardMaterial({ color: 0x2b2f3a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.35), mat); torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), skin); head.position.y = 1.77;
  torso.castShadow = head.castShadow = true;
  const limb = (w, h, x, y, m) => { const p = new THREE.Group(); p.position.set(x, y, 0); const l = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), m); l.position.y = -h / 2; l.castShadow = true; p.add(l); g.add(p); return p; };
  g.userData = { legL: limb(0.24, 0.75, -0.15, 0.78, dark), legR: limb(0.24, 0.75, 0.15, 0.78, dark), armL: limb(0.18, 0.65, -0.4, 1.5, mat), armR: limb(0.18, 0.65, 0.4, 1.5, mat), name };
  g.add(torso, head);
  if (name) { const l = makeLabel(name, 2.4); l.position.y = 2.4; g.add(l); g.userData.label = l; }
  return g;
}
function animatePerson(g, a, t) {
  const u = g.userData, k = a === 2 ? 1 : a === 1 ? 0.6 : 0, s = Math.sin(t * (a === 2 ? 12 : 8)) * k * 0.9;
  u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s; u.armR.rotation.x = s;
}
const me = { x: SPAWN.x, y: 0, z: SPAWN.z, vy: 0, vx: 0, vz: 0, yaw: 0, anim: 0, group: makePerson(0x3b82f6) };
scene.add(me.group);
const cam = { yaw: 0, pitch: 0.4, lastMouse: 0, pos: new THREE.Vector3(0, 30, 30) };

/* ------------------------------- networking -------------------------------- */
const token = localStorage.getItem('vl_token') || (() => { const t = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)) + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); localStorage.setItem('vl_token', t); return t; })();
const socket = io();
const call = (ev, d = {}) => new Promise(r => socket.emit(ev, d, r));
const setStatus = t => { $('#status').textContent = t; };
$('#name').value = localStorage.getItem('vl_name') || '';
function hello() {
  const name = $('#name').value.trim(); if (name) localStorage.setItem('vl_name', name);
  return call('hello', { token, name }).then(r => {
    if (!r.ok) { setStatus(r.error); return r; }
    S.pid = r.pid; S.profile = r.profile; me.group.removeFromParent(); me.group = makePerson(hueColor(r.pid)); scene.add(me.group);
    updateCash(true); setStatus('Connected ✓'); return r;
  });
}
socket.on('connect', async () => {
  await hello();
  if (S.room && S.inGame) { // automatic reconnect: rejoin the same room
    const r = await call('room:join', { code: S.room.code });
    if (r.ok) { socket.emit('play'); toast('Reconnected', 'ok'); } else { alert(r.error); location.reload(); }
  }
});
socket.on('disconnect', () => { setStatus('Disconnected. Reconnecting…'); if (S.inGame) toast('Connection lost. Reconnecting…', 'err'); });
socket.on('kicked', () => { alert('You signed in from another tab or device.'); location.reload(); });
socket.on('notify', n => { toast(n.text, n.kind); if (n.kind === 'ok') sfx('ok'); });
let lastCash = 0;
socket.on('profile', p => { S.profile = p; updateCash(); if (S.panel) renderPanel(S.panel); });
socket.on('room:state', st => {
  S.room = { code: st.code }; S.players = st.players; S.houses = st.houses; renderLobby(); renderPlayerList();
  for (const [pid, e] of S.remote) { const n = S.players.find(p => p.id === pid)?.name; if (n && n !== e.g.userData.name) { replaceRemote(pid); } }
  if (S.panel === 'housep') renderHouse();
});
socket.on('job', j => { S.job = j; if (!j) { beam.visible = false; $('#jobbox').classList.add('hidden'); } else beam.visible = true; if (S.panel === 'jobs') renderPanel('jobs'); });
socket.on('veh:list', list => {
  const seen = new Set();
  for (const d of list) {
    seen.add(d.id); let e = S.vehicles.get(d.id);
    if (!e) {
      const g = makeCar(d.type, d.color); g.position.set(d.x, 0, d.z); g.rotation.y = d.yaw; scene.add(g);
      e = { g, data: d, tx: d.x, tz: d.z, tyaw: d.yaw, speed: 0, steer: 0, brake: false }; S.vehicles.set(d.id, e);
    } else {
      if (e.data.color !== d.color) e.g.userData.paint.color.setHex(d.color);
      e.data = d; if (!d.driver) { e.tx = d.x; e.tz = d.z; e.tyaw = d.yaw; e.speed = 0; e.brake = false; }
    }
  }
  for (const [id, e] of S.vehicles) if (!seen.has(id)) { scene.remove(e.g); S.vehicles.delete(id); }
  if (S.mode === 'drive') { const e = S.vehicles.get(S.myVeh); if (!e || e.data.driver !== S.pid) exitLocal(); }
  if (S.panel === 'garage') renderPanel('garage');
});
function makeRemote(pid) {
  const name = S.players.find(p => p.id === pid)?.name || 'Player';
  const g = makePerson(hueColor(pid), name); scene.add(g);
  const e = { g, tx: 0, ty: 0, tz: 0, tyaw: 0, anim: 0, inVeh: false, fresh: true }; S.remote.set(pid, e); return e;
}
function replaceRemote(pid) { const o = S.remote.get(pid); scene.remove(o.g); const n = makeRemote(pid); Object.assign(n, { tx: o.tx, ty: o.ty, tz: o.tz, tyaw: o.tyaw, anim: o.anim, inVeh: o.inVeh, fresh: false }); n.g.position.set(o.tx, o.ty, o.tz); }
socket.on('snap', ({ p, v }) => {
  if (!S.inGame) return;
  for (const pid in p) {
    if (pid === S.pid) continue; const a = p[pid]; const e = S.remote.get(pid) || makeRemote(pid);
    e.tx = a[0]; e.ty = a[1]; e.tz = a[2]; e.tyaw = a[3]; e.anim = a[4]; e.inVeh = !!a[5];
  }
  for (const [pid, e] of S.remote) if (!(pid in p)) { scene.remove(e.g); S.remote.delete(pid); }
  for (const id in v) { const e = S.vehicles.get(id); if (!e || e.data.driver === S.pid) continue; const a = v[id]; e.tx = a[0]; e.tz = a[1]; e.tyaw = a[2]; e.speed = a[3]; e.steer = a[4]; e.brake = !!a[5]; }
});
setInterval(() => {
  if (!S.inGame || !socket.connected) return;
  const m = { x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(2), a: me.anim };
  if (S.mode === 'drive' && S.sim) m.v = { x: +S.sim.x.toFixed(2), z: +S.sim.z.toFixed(2), yaw: +S.sim.yaw.toFixed(2), speed: +S.sim.speed.toFixed(1), steer: +S.sim.steer.toFixed(2), brake: S.brake };
  socket.volatile.emit('state', m);
}, 66);

/* ---------------------------------- UI core --------------------------------- */
function toast(text, kind = '') {
  const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text; $('#toasts').appendChild(d);
  if (kind === 'err') sfx('err'); setTimeout(() => d.remove(), 4500);
}
function updateCash(silent) {
  const c = S.profile?.cash ?? 0, el = $('#cash'); el.textContent = fmt(c);
  if (!silent && c !== lastCash) { el.className = c > lastCash ? 'up' : 'down'; if (c > lastCash) sfx('cash'); setTimeout(() => (el.className = ''), 600); }
  lastCash = c;
}
function renderLobby() { $('#roomCode').textContent = S.room.code; $('#lobbyList').innerHTML = S.players.map(p => `<li>${esc(p.name)}<span>${p.id === S.pid ? 'you' : ''}</span></li>`).join(''); $('#roomtag').textContent = 'ROOM ' + S.room.code; }
function renderPlayerList() { $('#plist').innerHTML = '<b>Players (' + S.players.length + ')</b><br>' + S.players.map(p => esc(p.name) + (p.id === S.pid ? ' (you)' : '')).join('<br>'); }
$('#btnCreate').onclick = async () => { await hello(); const r = await call('room:create'); if (!r.ok) return setStatus(r.error); showLobby(); };
$('#btnJoin').onclick = async () => { await hello(); const r = await call('room:join', { code: $('#codeIn').value }); if (!r.ok) return setStatus(r.error); showLobby(); };
function showLobby() { $('#menu').classList.add('hidden'); $('#lobby').classList.remove('hidden'); }
$('#btnCopy').onclick = () => { navigator.clipboard?.writeText(S.room.code); toast('Room code copied', 'ok'); };
$('#btnLeaveLobby').onclick = async () => { await call('room:leave'); S.room = null; $('#lobby').classList.add('hidden'); $('#menu').classList.remove('hidden'); };
$('#btnStart').onclick = () => {
  audioInit(); S.inGame = true; $('#lobby').classList.add('hidden'); $('#hud').classList.remove('hidden');
  Object.assign(me, { x: SPAWN.x, z: SPAWN.z, y: 0 }); socket.emit('play'); renderPlayerList(); $('#c').requestPointerLock?.();
};
$('#pLeave').onclick = async () => { await call('room:leave'); location.reload(); };
$('#pResume').onclick = () => { closePanel(); $('#c').requestPointerLock(); };
$('#setVol').oninput = e => { AU.vol = e.target.value / 100; if (AU.amb) AU.amb.gain.value = 0.02 * AU.vol; };
$('#setSens').oninput = e => { S.sens = e.target.value / 100; };
$$('.close').forEach(b => (b.onclick = () => closePanel()));

function openPanel(id) { if (S.panel) closePanel(); S.panel = id; $('#' + id).classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); renderPanel(id); sfx('click'); }
function closePanel() { if (!S.panel) return; $('#' + S.panel).classList.add('hidden'); S.panel = null; }
function renderPanel(id) { ({ dealer: renderDealer, garage: renderGarage, jobs: renderJobs, housep: renderHouse, pause: () => {} })[id]?.(); }
const act = async (ev, d) => { const r = await call(ev, d); if (!r.ok) toast(r.error, 'err'); return r; };

/* ---- dealership with 3D preview ---- */
let dealSel = 'suv', prev = null;
function renderDealer() {
  const own = S.profile.vehicles;
  $('#dealList').innerHTML = Object.entries(VEHICLES).map(([id, v]) => `<button class="item ${id === dealSel ? 'sel' : ''}" data-id="${id}"><b>${v.name}</b><span>${own[id] ? 'Owned' : fmt(v.price)}</span></button>`).join('');
  $$('#dealList .item').forEach(b => (b.onclick = () => { dealSel = b.dataset.id; sfx('click'); renderDealer(); }));
  const v = VEHICLES[dealSel], bar = (n, x) => `<div class="stat">${n}<i><b style="width:${clamp(x, 0.05, 1) * 100}%"></b></i></div>`;
  $('#dealInfo').innerHTML = `<h3>${v.name}</h3>${bar('Top speed', v.maxSpeed / 62)}${bar('Acceleration', v.accel / 22)}${bar('Handling', v.turn / 0.6)}${bar('Braking', v.brake / 38)}<div class="stat">Weight<span>${v.weight} kg · ${Math.round(v.maxSpeed * 3.6)} km/h</span></div>`;
  const b = $('#dealBuy'), owned = !!own[dealSel];
  b.disabled = owned || S.profile.cash < v.price; b.textContent = owned ? 'Owned' : S.profile.cash < v.price ? `Need ${fmt(v.price - S.profile.cash)} more` : `Buy for ${fmt(v.price)}`;
  b.onclick = async () => { const r = await act('dealer:buy', { type: dealSel }); if (r.ok) sfx('ok'); };
  if (!prev) {
    const r = new THREE.WebGLRenderer({ canvas: $('#dealCanvas'), antialias: true, alpha: true }); r.setPixelRatio(1); r.setSize(420, 260, false);
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(4, 6, 5); sc.add(dl);
    const c = new THREE.PerspectiveCamera(40, 420 / 260, 0.1, 50); c.position.set(6, 2.6, 7); c.lookAt(0, 0.8, 0); prev = { r, sc, c, car: null };
  }
  if (prev.car) prev.sc.remove(prev.car); prev.car = makeCar(dealSel, own[dealSel]?.color ?? v.color); prev.sc.add(prev.car);
}

/* ---- garage + properties ---- */
let garTab = 'veh';
$$('.tabs button').forEach(b => (b.onclick = () => { garTab = b.dataset.tab; renderGarage(); }));
function renderGarage() {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === garTab));
  const body = $('#garBody');
  if (garTab === 'veh') {
    const spawned = [...S.vehicles.values()].find(e => e.data.owner === S.pid);
    body.innerHTML = `<p class="sub">Paint costs ${fmt(PAINT_COST)}. You can have one vehicle out at a time.</p>` + Object.entries(S.profile.vehicles).map(([t, o]) => `
      <div class="rowcard"><div class="grow"><b>${VEHICLES[t].name}</b><small>${spawned?.data.type === t ? 'Currently in the world' : 'In garage'}</small></div>
      <div>${PAINTS.map(c => `<button class="sw" data-t="${t}" data-c="${c}" style="background:${hex(c)}${o.color === c ? ';border-color:#fff' : ''}"></button>`).join(' ')}</div>
      ${spawned?.data.type === t ? `<button data-ret="1">Return</button>` : `<button data-spawn="${t}">Spawn</button>`}</div>`).join('');
    $$('#garBody .sw').forEach(b => (b.onclick = () => act('veh:paint', { type: b.dataset.t, color: +b.dataset.c })));
    $$('#garBody [data-spawn]').forEach(b => (b.onclick = async () => { const r = await act('veh:spawn', { type: b.dataset.spawn }); if (r.ok) { closePanel(); toast('Vehicle spawned in front of you', 'ok'); } }));
    $$('#garBody [data-ret]').forEach(b => (b.onclick = () => act('veh:despawn')));
  } else {
    const mine = HOUSES.filter(h => S.houses[h.id]?.owner === S.pid);
    body.innerHTML = mine.length ? mine.map(h => `<div class="rowcard"><div class="grow"><b>${h.name}</b><small>Worth ${fmt(h.price)} · sells for ${fmt(h.price * 0.7)}</small></div><button data-sell="${h.id}">Sell</button></div>`).join('') : '<p class="sub">You do not own any property in this room yet. Visit a house door to buy it.</p>';
    $$('#garBody [data-sell]').forEach(b => (b.onclick = () => act('house:sell', { id: b.dataset.sell })));
  }
}

/* ---- jobs ---- */
function renderJobs() {
  $('#jobBody').innerHTML = Object.entries(JOBS).map(([id, j]) => `<div class="rowcard"><div class="grow"><b>${j.name}</b><small>${j.desc}</small></div><button data-job="${id}" ${S.job && id !== 'civilian' ? 'disabled' : ''}>${id === 'civilian' ? 'Clock out' : 'Start'}</button></div>`).join('') +
    (S.job ? `<button id="jobQuit" class="ghost">Quit current job</button>` : '');
  $$('#jobBody [data-job]').forEach(b => (b.onclick = async () => { if (b.dataset.job === 'civilian') await act('job:cancel'); else { const r = await act('job:start', { id: b.dataset.job }); if (r.ok) { closePanel(); toast('Job started. Follow the marker!', 'ok'); } } }));
  $('#jobQuit')?.addEventListener('click', () => act('job:cancel'));
}

/* ---- houses ---- */
function renderHouse() {
  const h = S.houseSel; if (!h) return; const o = S.houses[h.id];
  $('#houseTitle').textContent = h.name;
  $('#houseBody').innerHTML = `<p class="sub">${o ? 'Owned by ' + esc(o.ownerName) : 'For sale: ' + fmt(h.price)}</p>
    ${o ? '' : `<button class="primary" id="hBuy" ${S.profile.cash < h.price ? 'disabled' : ''}>${S.profile.cash < h.price ? 'Not enough cash' : 'Buy for ' + fmt(h.price)}</button>`}
    ${o ? '<button class="primary" id="hEnter">Go inside</button>' : ''}${o?.owner === S.pid ? `<button class="ghost" id="hSell">Sell for ${fmt(h.price * 0.7)}</button>` : ''}`;
  $('#hBuy')?.addEventListener('click', async () => { const r = await act('house:buy', { id: h.id }); if (r.ok) sfx('ok'); });
  $('#hSell')?.addEventListener('click', () => act('house:sell', { id: h.id }));
  $('#hEnter')?.addEventListener('click', async () => { const r = await act('house:enter', { id: h.id }); if (r.ok) { closePanel(); enterHouse(h); } });
}
function enterHouse(h) { const i = HOUSES.indexOf(h), it = interiors[i]; S.interior = { i, h }; me.x = it.spawn.x; me.z = it.spawn.z; me.vx = me.vz = 0; roomLight.visible = true; roomLight.position.set(it.ox, 3.6, it.oz); }
function leaveHouse() { const h = S.interior.h; me.x = h.dx; me.z = h.dz; S.interior = null; roomLight.visible = false; }

/* -------------------------------- interactions ------------------------------- */
const PLACES = [
  ...SPECIAL.filter(s => s.id === 'dealer' || s.id === 'jobs').map(s => ({ x: s.ix, z: s.iz, r: 7, label: () => s.id === 'dealer' ? 'Browse vehicles' : 'Choose a job', act: () => openPanel(s.id === 'dealer' ? 'dealer' : 'jobs') })),
  ...HOUSES.map(h => ({ x: h.dx, z: h.dz, r: 3.5, label: () => { const o = S.houses[h.id]; return o ? `${h.name}: owned by ${o.ownerName}` : `${h.name}: for sale ${fmt(h.price)}`; }, act: () => { S.houseSel = h; openPanel('housep'); } })),
];
function findPrompt() {
  if (S.mode === 'drive') return { label: 'Exit vehicle', act: exitVeh };
  if (S.interior) { const it = interiors[S.interior.i]; if (Math.hypot(me.x - it.exit.x, me.z - it.exit.z) < 3.5) return { label: 'Leave house', act: leaveHouse }; return null; }
  for (const [id, e] of S.vehicles) if (e.data.owner === S.pid && !e.data.driver && Math.hypot(me.x - e.g.position.x, me.z - e.g.position.z) < 5.5) return { label: 'Drive ' + VEHICLES[e.data.type].name, act: () => enterVeh(id) };
  for (const p of PLACES) if (Math.hypot(me.x - p.x, me.z - p.z) < p.r) return { label: p.label(), act: p.act };
  return null;
}
async function enterVeh(id) {
  const r = await act('veh:enter', { id }); if (!r.ok) return; const e = S.vehicles.get(id); if (!e) return;
  S.mode = 'drive'; S.myVeh = id; S.sim = new VehicleSim(e.data.type, e.g.position.x, e.g.position.z, e.g.rotation.y); S.head = isNight(); me.group.visible = false; sfx('click');
}
function exitLocal() { S.mode = 'foot'; S.myVeh = null; S.sim = null; me.group.visible = true; $('#speedo').classList.add('hidden'); engineAudio(0, 0, false); }
function exitVeh() {
  const e = S.vehicles.get(S.myVeh), sim = S.sim; if (!e || !sim) return exitLocal();
  const w = VEHICLES[e.data.type].size[0] / 2 + 1.2;
  me.x = sim.x + Math.cos(sim.yaw) * w; me.z = sim.z - Math.sin(sim.yaw) * w; me.y = 0; resolveCircle(me, 0.45, colliders);
  socket.emit('veh:exit', { x: sim.x, z: sim.z, yaw: sim.yaw }); exitLocal();
}

/* ----------------------------------- input ----------------------------------- */
const keys = {};
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return; keys[e.code] = true;
  if (!S.inGame) return;
  if (e.code === 'Tab') { e.preventDefault(); $('#plist').classList.remove('hidden'); }
  if (e.code === 'Escape' && S.panel && S.panel !== 'pause') closePanel();
  if (S.panel) return;
  if (e.code === 'KeyE') findPrompt()?.act();
  if (e.code === 'KeyG') openPanel('garage');
  if (e.code === 'KeyL') S.head = !S.head;
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') $('#plist').classList.add('hidden'); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
$('#c').addEventListener('click', () => { if (S.inGame && !S.panel) $('#c').requestPointerLock(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && S.inGame && !S.panel) openPanel('pause'); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== $('#c')) return;
  cam.yaw -= e.movementX * 0.0025 * S.sens; cam.pitch = clamp(cam.pitch + e.movementY * 0.0025 * S.sens, 0.05, 1.25); cam.lastMouse = performance.now();
});

/* ---------------------------------- update ----------------------------------- */
function footUpdate(dt, t) {
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let mx = Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * r, mz = Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * r; const len = Math.hypot(mx, mz);
  const run = keys.ShiftLeft || keys.ShiftRight, spd = run ? 9 : 5;
  if (len > 0) { mx /= len; mz /= len; me.yaw = angLerp(me.yaw, Math.atan2(mx, mz), 1 - Math.exp(-14 * dt)); }
  const k = 1 - Math.exp(-12 * dt); me.vx += (mx * spd * (len > 0 ? 1 : 0) - me.vx) * k; me.vz += (mz * spd * (len > 0 ? 1 : 0) - me.vz) * k;
  me.x += me.vx * dt; me.z += me.vz * dt;
  me.vy -= 22 * dt; me.y += me.vy * dt; if (me.y <= 0) { me.y = 0; me.vy = 0; if (keys.Space && !S.panel) me.vy = 7; }
  resolveCircle(me, 0.45, colliders);
  me.anim = len > 0 ? (run ? 2 : 1) : 0;
  me.group.position.set(me.x, me.y, me.z); me.group.rotation.y = me.yaw; animatePerson(me.group, me.anim, t);
}
function driveUpdate(dt) {
  const e = S.vehicles.get(S.myVeh), sim = S.sim; if (!e || !sim) return exitLocal();
  const inp = { up: keys.KeyW || keys.ArrowUp, down: keys.KeyS || keys.ArrowDown, left: keys.KeyA || keys.ArrowLeft, right: keys.KeyD || keys.ArrowRight, brake: keys.Space };
  sim.step(dt, inp, colliders);
  if (sim.hit > 6) sfx('crash');
  S.brake = !!(inp.brake || (inp.down && sim.speed > 0.5));
  e.g.position.set(sim.x, 0, sim.z); e.g.rotation.y = sim.yaw; me.x = sim.x; me.z = sim.z; me.y = 0; me.yaw = sim.yaw; me.anim = 0;
  setCarState(e.g, { steer: sim.steer, speed: sim.speed, brake: S.brake, head: S.head, dt });
  engineAudio(Math.abs(sim.speed) / sim.def.maxSpeed, inp.up ? 1 : 0, true);
  const kmh = Math.round(Math.abs(sim.speed) * 3.6); $('#spd').textContent = kmh;
  $('#gear').textContent = sim.speed < -0.5 ? 'R' : Math.abs(sim.speed) < 0.5 ? 'N' : clamp(1 + Math.floor((Math.abs(sim.speed) / sim.def.maxSpeed) * 6), 1, 6);
  $('#speedo').classList.remove('hidden');
}
function updateRemotes(dt, t) {
  const k = 1 - Math.exp(-14 * dt);
  for (const e of S.remote.values()) {
    const far = Math.hypot(e.tx - e.g.position.x, e.tz - e.g.position.z) > 30;
    if (e.fresh || far) { e.g.position.set(e.tx, e.ty, e.tz); e.g.rotation.y = e.tyaw; e.fresh = false; }
    e.g.position.x += (e.tx - e.g.position.x) * k; e.g.position.y += (e.ty - e.g.position.y) * k; e.g.position.z += (e.tz - e.g.position.z) * k;
    e.g.rotation.y = angLerp(e.g.rotation.y, e.tyaw, k); e.g.visible = !e.inVeh; animatePerson(e.g, e.anim, t);
  }
  for (const [id, e] of S.vehicles) {
    if (S.mode === 'drive' && id === S.myVeh) continue;
    const far = Math.hypot(e.tx - e.g.position.x, e.tz - e.g.position.z) > 30;
    if (far) e.g.position.set(e.tx, 0, e.tz);
    e.g.position.x += (e.tx - e.g.position.x) * k; e.g.position.z += (e.tz - e.g.position.z) * k; e.g.rotation.y = angLerp(e.g.rotation.y, e.tyaw, k);
    setCarState(e.g, { steer: e.steer, speed: e.speed, brake: e.brake, head: e.data.driver ? isNight() : false, dt });
  }
}
function updateCamera(dt, now) {
  const driving = S.mode === 'drive', dist = driving ? 9 : 5.5;
  if (driving && now - cam.lastMouse > 1500) cam.yaw = angLerp(cam.yaw, me.yaw, 1 - Math.exp(-3 * dt));
  const tx = me.x, ty = me.y + (driving ? 1.6 : 1.7), tz = me.z, ce = Math.cos(cam.pitch);
  const dx = -Math.sin(cam.yaw) * ce, dy = Math.sin(cam.pitch), dz = -Math.cos(cam.yaw) * ce;
  let use = dist; // pull the camera in if a building is in the way
  if (!S.interior) for (let s = 1; s <= 10; s++) { const d = (dist * s) / 10, x = tx + dx * d, y = ty + dy * d, z = tz + dz * d; if (colliders.some(c => y < c.h && x > c.minx - 0.4 && x < c.maxx + 0.4 && z > c.minz - 0.4 && z < c.maxz + 0.4)) { use = Math.max(1.2, d - 0.8); break; } }
  const want = new THREE.Vector3(tx + dx * use, Math.max(0.5, ty + dy * use), tz + dz * use);
  cam.pos.lerp(want, 1 - Math.exp(-12 * dt)); camera.position.copy(cam.pos); camera.lookAt(tx, ty, tz);
}
function drawMap() {
  const c = $('#mini'), g = c.getContext('2d'), W = 170, sc = 0.45, cy = cam.yaw, fx = Math.sin(cy), fz = Math.cos(cy), rx = -Math.cos(cy), rz = Math.sin(cy);
  const P = (x, z) => { const dx = x - me.x, dz = z - me.z; return [W / 2 + (dx * rx + dz * rz) * sc, W / 2 - (dx * fx + dz * fz) * sc]; };
  g.clearRect(0, 0, W, W); g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip(); g.fillStyle = '#18221a'; g.fillRect(0, 0, W, W);
  g.strokeStyle = '#4a4f58'; g.lineWidth = ROAD.width * sc;
  for (const L of ROAD.lines) { g.beginPath(); g.moveTo(...P(-200, L)); g.lineTo(...P(200, L)); g.stroke(); g.beginPath(); g.moveTo(...P(L, -200)); g.lineTo(...P(L, 200)); g.stroke(); }
  for (const s of SPECIAL) { const [x, y] = P(s.x, s.z); g.fillStyle = s.id === 'dealer' || s.id === 'jobs' ? '#ffb84d' : '#7b8aa8'; g.fillRect(x - 4, y - 4, 8, 8); }
  for (const h of HOUSES) { const [x, y] = P(h.x, h.z), o = S.houses[h.id]; g.fillStyle = !o ? '#4ade80' : o.owner === S.pid ? '#60a5fa' : '#f87171'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  for (const e of S.remote.values()) { const [x, y] = P(e.tx, e.tz); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  if (S.job) { let [x, y] = P(S.job.target.x, S.job.target.z); const dx = x - W / 2, dy = y - W / 2, d = Math.hypot(dx, dy), m = W / 2 - 8; if (d > m) { x = W / 2 + (dx / d) * m; y = W / 2 + (dy / d) * m; } g.fillStyle = '#ffb84d'; g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-5, -5, 10, 10); g.restore(); }
  g.restore(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(W / 2, W / 2 - 8); g.lineTo(W / 2 + 6, W / 2 + 6); g.lineTo(W / 2 - 6, W / 2 + 6); g.fill();
}
function updateHud(now, frame) {
  const p = S.panel ? null : findPrompt(), pe = $('#prompt');
  if (p) { pe.textContent = 'E: ' + p.label; pe.classList.remove('hidden'); } else pe.classList.add('hidden');
  $('#lockhint').classList.toggle('hidden', !!document.pointerLockElement || !!S.panel);
  if (S.job) {
    const t = S.job.target, d = Math.round(Math.hypot(me.x - t.x, me.z - t.z)), def = JOBS[S.job.id];
    const needVeh = S.job.stage === 'dropoff' || def.pickupInVehicle, hint = needVeh && S.mode !== 'drive' ? '<small>Get in a vehicle to complete this step</small>' : '';
    $('#jobbox').innerHTML = `<b>${esc(S.job.name)}</b>: ${esc(S.job.text)}<small>${d} m away · pays ${fmt(S.job.pay)}</small>${hint}`; $('#jobbox').classList.remove('hidden');
    beam.position.set(t.x, 40, t.z); beam.material.color.setHex(S.job.stage === 'pickup' ? 0x60a5fa : 0xffb84d);
    if (!S.interior && now - S.lastAdv > 400) {
      S.lastAdv = now;
      if (d < 9 && (!needVeh || S.mode === 'drive') && !S.advancing) { S.advancing = true; call('job:advance').then(r => { S.advancing = false; if (!r.ok) toast(r.error, 'err'); }); }
    }
  }
  if (frame % 6 === 0) drawMap();
}

let last = performance.now(), frame = 0;
function loop(now) {
  requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; frame++; const t = now / 1000;
  if (S.inGame) {
    if (!S.panel || S.panel === 'pause') { if (S.mode === 'foot') footUpdate(dt, t); else driveUpdate(dt); } else if (S.mode === 'drive') driveUpdate(dt);
    updateRemotes(dt, t); updateCamera(dt, now); updateHud(now, frame);
    if (S.panel === 'dealer' && prev) { prev.car.rotation.y += dt * 0.6; prev.r.render(prev.sc, prev.c); }
  } else { // menu: slowly orbit the town
    const a = t * 0.05; camera.position.set(Math.cos(a) * 130, 55, Math.sin(a) * 130); camera.lookAt(0, 5, 0); me.group.visible = false;
  }
  if (S.inGame) me.group.visible = S.mode === 'foot';
  updateSky(me); renderer.render(scene, camera);
}
requestAnimationFrame(loop);
setTimeout(() => { const l = $('#loading'); l.style.opacity = 0; setTimeout(() => l.remove(), 600); }, 400);
window.__vl = { S, me, THREE };
