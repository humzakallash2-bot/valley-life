import * as THREE from 'three';
import { VEHICLES, HOUSES, SPECIAL, PAINTS, PAINT_COST, JOBS, SPAWN, ROAD, MODS, RACES, DAILY, HOME_SLOTS, FURN, VENUES, HOME_MAX } from '/shared/config.js';
import { buildWorld, buildInterior, buildRoom, makeLabel } from './world.js';
import { makeCar, setCarState, VehicleSim, resolveCircle } from './vehicle.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angLerp = (a, b, t) => a + ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * t;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');

const S = { pid: null, profile: null, room: null, players: [], houses: {}, inGame: false, job: null, vehicles: new Map(), remote: new Map(),
  mode: 'foot', myVeh: null, sim: null, panel: null, interior: null, houseSel: null, head: false, brake: false, advancing: false, lastAdv: 0, sens: 1, race: null, lobby: 0, zone: null, hp: 100, hpShow: 0, venue: null };

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
const rooms = HOME_SLOTS.map((_, i) => buildRoom(scene, 1400 + i * 40, 1000)); rooms.forEach(r => colliders.push(...r.cols));
const CX = [-6, -2, 2, 6], CZ = [-5, -1.5, 2];
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
  const o2 = ctx.createOscillator(); o2.type = 'square'; const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2).connect(f); o2.start();
  AU.engine = { osc, o2, g, f };
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
function engineAudio(ratio, thr, on, nitro) {
  if (!AU.engine) return; const t = AU.ctx.currentTime, { osc, o2, g, f } = AU.engine, gr = Math.min(5, Math.floor(ratio * 6)), rpm = ratio * 6 - gr;
  const fr = 50 + rpm * 120 + gr * 6 + thr * 18 + (nitro ? 40 : 0);
  osc.frequency.setTargetAtTime(fr, t, 0.05); o2.frequency.setTargetAtTime(fr * 2.01, t, 0.05); f.frequency.setTargetAtTime(350 + ratio * 1200 + thr * 500 + (nitro ? 900 : 0), t, 0.08);
  g.gain.setTargetAtTime(on ? AU.vol * 0.06 * (0.5 + thr * 0.5) : 0, t, 0.08);
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
const keep = p => { try { localStorage.setItem('vl_blob', JSON.stringify(p.blob)); } catch {} }; // signed save copy kept in this browser
const socket = io();
const call = (ev, d = {}) => new Promise(r => socket.emit(ev, d, r));
const setStatus = t => { $('#status').textContent = t; };
$('#name').value = localStorage.getItem('vl_name') || '';
function hello() {
  const name = $('#name').value.trim(); if (name) localStorage.setItem('vl_name', name);
  let blob = null; try { blob = JSON.parse(localStorage.getItem('vl_blob') || 'null'); } catch {}
  return call('hello', { token, name, blob }).then(r => {
    if (!r.ok) { setStatus(r.error); return r; }
    S.pid = r.pid; S.profile = r.profile; keep(r.profile); me.group.removeFromParent(); me.group = makePerson(hueColor(r.pid)); scene.add(me.group);
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
socket.on('profile', p => { S.profile = p; keep(p); updateCash(); if (S.panel) renderPanel(S.panel); });
socket.on('room:state', st => {
  S.room = { code: st.code }; S.players = st.players; S.houses = st.houses; renderLobby(); renderPlayerList(); syncHomes();
  for (const [pid, e] of S.remote) { const n = S.players.find(p => p.id === pid)?.name; if (n && n !== e.g.userData.name) { replaceRemote(pid); } }
  if (S.panel === 'housep') renderHouse();
});
socket.on('job', j => { S.job = j; if (!j) { beam.visible = false; $('#jobbox').classList.add('hidden'); } else beam.visible = true; if (S.panel === 'jobs') renderPanel('jobs'); });
socket.on('veh:list', list => {
  const seen = new Set();
  for (const d of list) {
    seen.add(d.id); let e = S.vehicles.get(d.id);
    if (!e) {
      const g = makeCar(d.type, d.color, d.kit); g.position.set(d.x, 0, d.z); g.rotation.y = d.yaw; scene.add(g);
      e = { g, data: d, tx: d.x, tz: d.z, tyaw: d.yaw, speed: 0, steer: 0, brake: false }; S.vehicles.set(d.id, e);
    } else {
      if ((e.data.kit | 0) !== (d.kit | 0)) { const g = makeCar(d.type, d.color, d.kit); g.position.copy(e.g.position); g.rotation.y = e.g.rotation.y; scene.remove(e.g); scene.add(g); e.g = g; }
      if (e.data.color !== d.color) e.g.userData.paint.color.setHex(d.color);
      e.data = d; if (!d.driver) { e.tx = d.x; e.tz = d.z; e.tyaw = d.yaw; e.speed = 0; e.brake = false; }
    }
  }
  for (const [id, e] of S.vehicles) if (!seen.has(id)) { scene.remove(e.g); S.vehicles.delete(id); }
  if (S.mode === 'drive') { const e = S.vehicles.get(S.myVeh); if (!e || e.data.driver !== S.pid) exitLocal(); }
  if (S.panel === 'garage') renderPanel('garage');
});
socket.on('race:start', ({ rid, id, solo, ms }) => { S.race = { rid, id, solo, startAt: Date.now() + ms, cp: 0, last: { x: RACES[id].pad[0], z: RACES[id].pad[1] } }; S.lobby = 0; sfx('ok'); });
socket.on('race:lobby', d => { S.lobby = d.n; });
socket.on('race:done', d => {
  S.race = null; const nth = ['1st', '2nd', '3rd'][d.place] || d.place + 1 + 'th';
  toast(d.solo ? `Solo run complete (${(d.ms / 1000).toFixed(1)}s): +${fmt(d.pay)}` : `🏁 ${nth} place! ${d.pay ? '+' + fmt(d.pay) : 'No prize this time'}`, d.pay ? 'ok' : ''); sfx('cash');
});
socket.on('hp', d => { S.hp = d.hp; if (d.show) S.hpShow = performance.now() + 4500; });
socket.on('respawn', () => { if (S.mode === 'drive') exitLocal(); S.interior = null; roomLight.visible = false; const s = HOME_SLOTS[S.players.find(p => p.id === S.pid)?.home.slot ?? 0]; me.x = s.dx; me.z = s.dz; me.y = 0; sfx('err'); });
socket.on('fight:fx', d => { if (d.pid === S.pid) return; const e = S.remote.get(d.pid); if (e) uss(e.g); });
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
$('#bGar').onclick = () => openPanel('garage'); $('#bTp').onclick = () => openPanel('tp'); $('#bQ').onclick = () => openPanel('quests');

function openPanel(id) { if (S.panel) closePanel(); S.panel = id; $('#' + id).classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); renderPanel(id); sfx('click'); }
function closePanel() { if (!S.panel) return; $('#' + S.panel).classList.add('hidden'); S.panel = null; }
function renderPanel(id) { ({ dealer: renderDealer, garage: renderGarage, jobs: renderJobs, housep: renderHouse, shop: renderShop, tp: renderTp, quests: renderQuests, venue: renderVenue, mart: renderMart, homep: renderHomeP, pause: () => {} })[id]?.(); }
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

/* ---- Brad's shop, teleport, quests ---- */
let shopSel = null;
function renderShop() {
  const owned = Object.keys(S.profile.vehicles); if (!owned.includes(shopSel)) shopSel = owned[0];
  const lv = S.profile.mods?.[shopSel] || {};
  $('#shopBody').innerHTML = `<div class="tabs">${owned.map(t => `<button data-t="${t}" class="${t === shopSel ? 'on' : ''}">${VEHICLES[t].name}</button>`).join('')}</div>` +
    Object.entries(MODS).map(([k, m]) => { const l = lv[k] | 0; return `<div class="rowcard"><div class="grow"><b>${m.name}</b><small>Level ${l} of ${m.max}</small></div><button data-s="${k}" ${l >= m.max || S.profile.cash < m.price[l] ? 'disabled' : ''}>${l >= m.max ? 'Maxed' : fmt(m.price[l])}</button></div>`; }).join('');
  $$('#shopBody [data-t]').forEach(b => (b.onclick = () => { shopSel = b.dataset.t; renderShop(); }));
  $$('#shopBody [data-s]').forEach(b => (b.onclick = async () => { const r = await act('shop:buy', { type: shopSel, stat: b.dataset.s }); if (r.ok) sfx('ok'); }));
}
const spot = id => { const s = SPECIAL.find(x => x.id === id); return [s.ix, s.iz]; };
const TP = [['Tutorial Race', ...RACES.tutorial.pad, 1], ['City Race (1st $100,000)', ...RACES.city.pad, 1], ['Grand Prix', ...RACES.gp.pad, 1], ["Brad's Shop", ...spot('mechanic')], ['Vehicle Dealership', ...spot('dealer')], ['Job Center', ...spot('jobs')], ['Valley Life Mart', ...spot('mart')], ['Cafe', ...spot('cafe')]];
function renderTp() {
  const my = S.players.find(p => p.id === S.pid)?.home, list = my && my.slot >= 0 ? [['My home', HOME_SLOTS[my.slot].dx, HOME_SLOTS[my.slot].dz], ...TP] : TP;
  $('#tpBody').innerHTML = list.map((p, i) => `<div class="rowcard"><div class="grow"><b>${p[0]}</b></div><button class="go" data-i="${i}">Go</button></div>`).join('');
  $$('#tpBody [data-i]').forEach(b => (b.onclick = () => tpTo(list[b.dataset.i])));
}
function tpTo([, x, z, race]) {
  closePanel(); if (S.interior) { S.interior = null; roomLight.visible = false; }
  if (S.mode === 'drive' && S.sim) { S.sim.x = x; S.sim.z = z; S.sim.speed = 0; } else { me.x = x; me.z = z; me.y = 0; }
  if (race && S.mode !== 'drive') { toast('Spawn a car (G), get in with E and drive into the ring', 'ok'); setTimeout(() => { if (![...S.vehicles.values()].some(e => e.data.owner === S.pid)) act('veh:spawn', { type: Object.keys(S.profile.vehicles)[0] }); }, 400); }
}
function renderQuests() {
  const d = S.profile.daily || { p: {}, done: {} }, p = S.profile, row = (n, s, ok) => `<div class="rowcard"><div class="grow"><b>${n}</b><small>${s}</small></div><span>${ok ? '✅' : ''}</span></div>`;
  $('#qBody').innerHTML = '<h3>Daily challenges (reset each day)</h3>' + DAILY.map(q => row(q.name, `${d.p[q.id] | 0}/${q.goal} · reward ${fmt(q.reward)}`, d.done[q.id])).join('') +
    '<h3>Quests</h3>' + row('Finish the Tutorial Race', 'Earns $50,000', p.tut) + row('Buy a car at the Dealership', 'Spend your prize money', Object.keys(p.vehicles).length > 1) + row('Upgrade a car at Brad’s Shop', 'Engine, brakes, tires, nitro or body kit', Object.values(p.mods || {}).some(m => Object.keys(m).length));
}

/* ---- player homes, venues, store, fighting ---- */
const homes = new Map();
function syncHomes() {
  for (const [pid, h] of homes) if (!S.players.some(p => p.id === pid)) { scene.remove(h.g); const i = colliders.indexOf(h.col); if (i >= 0) colliders.splice(i, 1); homes.delete(pid); }
  for (const p of S.players) {
    if (!p.home || p.home.slot < 0) continue; const s = HOME_SLOTS[p.home.slot]; let h = homes.get(p.id);
    if (!h || h.slot !== p.home.slot) {
      if (h) { scene.remove(h.g); colliders.splice(colliders.indexOf(h.col), 1); }
      const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 12), new THREE.MeshStandardMaterial({ color: p.home.ext, roughness: 0.8 })); body.position.y = 2.5; body.castShadow = body.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1, 4), new THREE.MeshStandardMaterial({ color: 0x7a3b2e })); roof.scale.set(15, 3.2, 13); roof.rotation.y = Math.PI / 4; roof.position.y = 6.6; roof.castShadow = true;
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, 0.3), new THREE.MeshStandardMaterial({ color: 0x5b3a22 })); door.position.set(0, 1.4, s.face * 6.1);
      const lab = makeLabel(p.name + "'s home", 6); lab.position.y = 10.5; g.add(body, roof, door, lab); g.position.set(s.x, 0, s.z); scene.add(g);
      const col = { minx: s.x - 7, maxx: s.x + 7, minz: s.z - 6, maxz: s.z + 6, h: 5 }; colliders.push(col); h = { g, body, lab, slot: p.home.slot, col, name: p.name }; homes.set(p.id, h);
    }
    h.body.material.color.setHex(p.home.ext);
    if (h.name !== p.name) { h.g.remove(h.lab); h.lab = makeLabel(p.name + "'s home", 6); h.lab.position.y = 10.5; h.g.add(h.lab); h.name = p.name; }
  }
  if (S.interior?.pid) refreshRoom(S.interior.pid);
}
function refreshRoom(pid) {
  const p = S.players.find(x => x.id === pid); if (!p?.home) return; const r = rooms[p.home.slot];
  r.floor.material.color.setHex(p.home.floor); r.wm.color.setHex(p.home.wall); r.fg.clear();
  p.home.items.forEach((id, i) => { const f = FURN[id], m = new THREE.Mesh(new THREE.BoxGeometry(...f.s), new THREE.MeshStandardMaterial({ color: f.c, roughness: 0.7 })); m.position.set(r.ox + CX[i % 4], f.s[1] / 2, r.oz + CZ[(i / 4) | 0]); m.castShadow = true; r.fg.add(m); });
}
function enterHome(pid) {
  const p = S.players.find(x => x.id === pid); if (!p?.home) return; const r = rooms[p.home.slot]; refreshRoom(pid);
  S.interior = { i: -1, h: HOME_SLOTS[p.home.slot], r, pid }; me.x = r.spawn.x; me.z = r.spawn.z; me.vx = me.vz = 0; roomLight.visible = true; roomLight.position.set(r.ox, 3.6, r.oz);
  toast(pid === S.pid ? 'Your home. Press H to decorate' : 'Visiting ' + p.name, 'ok');
}
for (const id of Object.keys(VENUES)) { const s = SPECIAL.find(x => x.id === id), g = makePerson(0xf59e0b, VENUES[id].npc); g.position.set(s.ix + 3, 0, s.iz + 0.5); g.rotation.y = Math.PI; scene.add(g); }
function renderVenue() {
  const v = VENUES[S.venue]; $('#venTitle').textContent = SPECIAL.find(x => x.id === S.venue).label;
  $('#venBody').innerHTML = `<p class="sub">${v.npc}: “Hi! What can I get you?”</p>` + v.items.map((it, i) => `<div class="rowcard"><div class="grow"><b>${it[0]}</b><small>Restores ${it[2]} health</small></div><button data-i="${i}" ${S.profile.cash < it[1] ? 'disabled' : ''}>${fmt(it[1])}</button></div>`).join('');
  $$('#venBody [data-i]').forEach(b => (b.onclick = async () => { const r = await act('venue:buy', { v: S.venue, i: +b.dataset.i }); if (r.ok) sfx('ok'); }));
}
function renderMart() {
  $('#martBody').innerHTML = Object.entries(FURN).map(([k, f]) => `<div class="rowcard"><div class="grow"><b>${f.name}</b></div><button data-k="${k}" ${S.profile.cash < f.price ? 'disabled' : ''}>${fmt(f.price)}</button></div>`).join('');
  $$('#martBody [data-k]').forEach(b => (b.onclick = async () => { const r = await act('mart:buy', { id: b.dataset.k }); if (r.ok) sfx('ok'); }));
}
function renderHomeP() {
  const h = S.profile.home, sw = part => PAINTS.map(c => `<button class="sw" data-p="${part}" data-c="${c}" style="background:${hex(c)}${h[part] === c ? ';border-color:#fff' : ''}"></button>`).join(' ');
  $('#homeBody').innerHTML = [['ext', 'Outside walls'], ['wall', 'Inside walls'], ['floor', 'Floor']].map(([p, n]) => `<div class="rowcard"><div class="grow"><b>${n}</b></div><div>${sw(p)}</div></div>`).join('') +
    `<h3>Furniture (${h.items.length}/${HOME_MAX})</h3>` + (h.items.map((id, i) => `<div class="rowcard"><div class="grow">${FURN[id].name}</div><button data-r="${i}">Sell ${fmt(FURN[id].price / 2)}</button></div>`).join('') || '<p class="sub">Nothing yet. Buy furniture at Valley Life Mart.</p>');
  $$('#homeBody .sw').forEach(b => (b.onclick = () => act('home:color', { part: b.dataset.p, color: +b.dataset.c })));
  $$('#homeBody [data-r]').forEach(b => (b.onclick = () => act('home:remove', { i: +b.dataset.r })));
}
function uss(g) { const l = makeLabel('USS!', 2.2); l.position.set(0, 3, 0); g.add(l); let t = 0; const iv = setInterval(() => { t += 0.05; l.position.y += 0.03; if (t > 0.9) { clearInterval(iv); g.remove(l); } }, 50); }
function punch() {
  const now = performance.now(); if (S.mode !== 'foot' || S.panel || now - (S.punchT || 0) < 450) return;
  S.punchT = now; uss(me.group); S.hpShow = now + 4500; socket.emit('fight:punch'); beep(140, 0.1, 'square', 0.2);
}

/* ---- races ---- */
const pads = Object.entries(RACES).map(([id, r]) => {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.35, 8, 40), new THREE.MeshBasicMaterial({ color: id === 'tutorial' ? 0x4ade80 : 0xffb84d })); ring.rotation.x = Math.PI / 2; ring.position.set(r.pad[0], 0.3, r.pad[1]); scene.add(ring);
  const l = makeLabel(r.name + ' · start zone', 8); l.position.set(r.pad[0], 6, r.pad[1]); scene.add(l); return ring;
});
const cpMesh = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.TorusGeometry(6, 0.5, 8, 32), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })); m.position.y = 3.2; m.visible = false; scene.add(m); return m; });
function resetToCp() {
  const R = S.race; if (!R || S.mode !== 'drive' || !S.sim) return;
  const def = RACES[R.id], n = def.cps[R.cp] || def.cps[def.cps.length - 1], s = S.sim;
  s.x = R.last.x; s.z = R.last.z; s.speed = 0; s.yaw = Math.atan2(n[0] - s.x, n[1] - s.z); toast('Back at your last checkpoint');
}
function tutText() {
  const p = S.profile; if (!p || p.tut || S.race) return '';
  if (![...S.vehicles.values()].some(e => e.data.owner === S.pid)) return 'Tutorial 1/3: press G (Garage) and spawn your Starter Sedan';
  if (S.mode !== 'drive') return 'Tutorial 2/3: walk up to your car and press E to get in';
  return 'Tutorial 3/3: drive into the green Tutorial Race ring (T teleports you there) and press E. Finish to win $50,000!';
}
function raceUpdate(now) {
  const hb = $('#hp'); hb.classList.toggle('hidden', performance.now() > S.hpShow); hb.firstElementChild.style.width = S.hp + '%';
  const tt = tutText(); $('#tut').textContent = tt; $('#tut').classList.toggle('hidden', !tt);
  pads.forEach(r => (r.rotation.z = now / 1000));
  const el = $('#race'), R = S.race, near = Object.keys(RACES).find(id => S.mode === 'drive' && !S.interior && Math.hypot(me.x - RACES[id].pad[0], me.z - RACES[id].pad[1]) < 12);
  if ((near || null) !== S.zone) { if (S.zone && !R) socket.emit('race:unready'); S.zone = near || null; S.lobby = 0; if (near && !R) socket.emit('race:ready', { id: near }, r => { if (!r.ok) toast(r.error, 'err'); }); }
  cpMesh.forEach(m => (m.visible = false));
  if (!R) { el.classList.toggle('hidden', !S.zone); if (S.zone) el.innerHTML = `<b>${RACES[S.zone].name}</b><br>${S.lobby ? 'Waiting for a 2nd racer in the zone…' : ''}<small>Press E to race solo (pays less)</small>`; return; }
  const def = RACES[R.id], left = R.startAt - Date.now(); el.classList.remove('hidden');
  if (left > 0) el.innerHTML = `<b>${def.name}</b><div class="big">${Math.ceil(left / 1000)}</div>`;
  else {
    el.innerHTML = `<b>${def.name}</b><br>Checkpoint ${Math.min(R.cp + 1, def.cps.length)} of ${def.cps.length} · ${((Date.now() - R.startAt) / 1000).toFixed(1)}s<small>R: back to last checkpoint · Shift: nitro</small>`;
    const c = def.cps[R.cp];
    if (c && S.mode === 'drive' && Math.hypot(me.x - c[0], me.z - c[1]) < 14) { socket.emit('race:cp', { rid: R.rid, i: R.cp }, r => { if (!r.ok) toast(r.error, 'err'); }); R.last = { x: c[0], z: c[1] }; R.cp++; sfx('ok'); }
  }
  [0, 1].forEach(i => { const c = def.cps[R.cp + i]; if (c) { cpMesh[i].visible = true; cpMesh[i].position.x = c[0]; cpMesh[i].position.z = c[1]; cpMesh[i].material.color.setHex(i ? 0x94a3b8 : 0x38bdf8); } });
}

/* ---- ambient traffic (client side) ---- */
const NPC = [], NCOL = [0xe53935, 0xfdd835, 0xffffff, 0x8e24aa, 0x9e9e9e, 0x43a047];
for (let i = 0; i < 12; i++) { const g = makeCar(['sedan', 'suv', 'van', 'taxi', 'pickup'][i % 5], NCOL[i % 6]); scene.add(g); NPC.push({ g, ax: i % 2, l: ROAD.lines[(i >> 1) % 5], s: i % 4 < 2 ? 1 : -1, p: -190 + i * 31, v: 9 + (i % 3) * 2, sp: 0 }); }
function npcStep(dt) {
  for (const n of NPC) {
    const hx = n.ax ? 0 : n.s, hz = n.ax ? n.s : 0, x = n.ax ? n.l - n.s * 3.5 : n.p, z = n.ax ? n.p : n.l + n.s * 3.5, dx = me.x - x, dz = me.z - z, ah = dx * hx + dz * hz, sd = Math.abs(dx * hz - dz * hx);
    n.sp += ((ah > 0 && ah < 10 && sd < 3 && !S.interior ? 0 : n.v) - n.sp) * Math.min(1, 3 * dt); n.p += n.s * n.sp * dt; if (n.p > 200) n.p = -200; if (n.p < -200) n.p = 200;
    if (S.mode === 'drive' && S.sim && Math.hypot(S.sim.x - x, S.sim.z - z) < 3.4) { S.sim.speed *= 0.8; n.sp = 0; }
    n.g.position.set(x, 0, z); n.g.rotation.y = n.ax ? (n.s > 0 ? 0 : Math.PI) : n.s > 0 ? Math.PI / 2 : -Math.PI / 2; setCarState(n.g, { speed: n.sp, dt, head: isNight() });
  }
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
  ...SPECIAL.filter(s => ['dealer', 'jobs', 'mechanic', 'mart', 'cafe', 'grocery', 'hospital'].includes(s.id)).map(s => ({ x: s.ix, z: s.iz, r: 7, label: () => ({ dealer: 'Browse vehicles', jobs: 'Choose a job', mechanic: "Enter Brad's Shop", mart: 'Shop at Valley Life Mart', cafe: 'Order at the cafe', grocery: 'Shop at the grocery', hospital: 'See the nurse' })[s.id], act: () => { if (VENUES[s.id]) { S.venue = s.id; openPanel('venue'); } else openPanel({ dealer: 'dealer', jobs: 'jobs', mechanic: 'shop', mart: 'mart' }[s.id]); } })),
  ...HOUSES.map(h => ({ x: h.dx, z: h.dz, r: 3.5, label: () => { const o = S.houses[h.id]; return o ? `${h.name}: owned by ${o.ownerName}` : `${h.name}: for sale ${fmt(h.price)}`; }, act: () => { S.houseSel = h; openPanel('housep'); } })),
];
function findPrompt() {
  if (S.mode === 'drive') return S.zone && !S.race ? { label: 'Race solo: ' + RACES[S.zone].name + ' (pays less)', act: () => act('race:ready', { id: S.zone, solo: true }) } : { label: 'Exit vehicle', act: exitVeh };
  if (S.interior) { const it = S.interior.r || interiors[S.interior.i]; if (Math.hypot(me.x - it.exit.x, me.z - it.exit.z) < 3.5) return { label: 'Leave house', act: leaveHouse }; return null; }
  for (const [id, e] of S.vehicles) if (e.data.owner === S.pid && !e.data.driver && Math.hypot(me.x - e.g.position.x, me.z - e.g.position.z) < 5.5) return { label: 'Drive ' + VEHICLES[e.data.type].name, act: () => enterVeh(id) };
  for (const [pid, h] of homes) { const s = HOME_SLOTS[h.slot]; if (Math.hypot(me.x - s.dx, me.z - s.dz) < 3.5) return { label: pid === S.pid ? 'Enter your home' : 'Visit ' + h.name + "'s home", act: () => enterHome(pid) }; }
  for (const p of PLACES) if (Math.hypot(me.x - p.x, me.z - p.z) < p.r) return { label: p.label(), act: p.act };
  return null;
}
async function enterVeh(id) {
  const r = await act('veh:enter', { id }); if (!r.ok) return; const e = S.vehicles.get(id); if (!e) return;
  S.mode = 'drive'; S.myVeh = id; S.sim = new VehicleSim(e.data.type, e.g.position.x, e.g.position.z, e.g.rotation.y, S.profile.mods?.[e.data.type]); S.head = isNight(); me.group.visible = false; sfx('click');
  if (!e.spot) { const sl = new THREE.SpotLight(0xfff2cc, 400, 70, 0.55, 0.5, 1.2); sl.position.set(0, 0.9, 2); sl.target.position.set(0, 0, 18); e.g.add(sl, sl.target); e.spot = sl; } // headlight beam
}
function exitLocal() { const e0 = S.vehicles.get(S.myVeh); if (e0?.spot) e0.spot.visible = false; S.mode = 'foot'; S.myVeh = null; S.sim = null; me.group.visible = true; $('#speedo').classList.add('hidden'); $('#nitro').classList.add('hidden'); engineAudio(0, 0, false); }
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
  if (e.code === 'KeyT') openPanel('tp');
  if (e.code === 'KeyQ') openPanel('quests');
  if (e.code === 'KeyR') resetToCp();
  if (e.code === 'KeyF') punch();
  if (e.code === 'KeyH' && S.interior?.pid === S.pid) openPanel('homep');
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
  S.stepT = (S.stepT || 0) - dt; if (len > 0 && me.y === 0 && S.stepT <= 0) { S.stepT = run ? 0.27 : 0.42; beep(80 + Math.random() * 50, 0.05, 'triangle', 0.1); } // footsteps
  me.group.position.set(me.x, me.y, me.z); me.group.rotation.y = me.yaw; animatePerson(me.group, me.anim, t);
  if (performance.now() - (S.punchT || 0) < 220) me.group.userData.armR.rotation.x = -1.6;
}
function driveUpdate(dt) {
  const e = S.vehicles.get(S.myVeh), sim = S.sim; if (!e || !sim) return exitLocal();
  const inp = { up: keys.KeyW || keys.ArrowUp, down: keys.KeyS || keys.ArrowDown, left: keys.KeyA || keys.ArrowLeft, right: keys.KeyD || keys.ArrowRight, brake: keys.Space, nitro: keys.ShiftLeft || keys.ShiftRight };
  if (S.race && Date.now() < S.race.startAt) { inp.up = inp.down = inp.nitro = false; inp.brake = true; }
  sim.step(dt, inp, colliders);
  if (sim.hit > 6) sfx('crash');
  S.brake = !!(inp.brake || (inp.down && sim.speed > 0.5));
  e.g.position.set(sim.x, 0, sim.z); e.g.rotation.y = sim.yaw; me.x = sim.x; me.z = sim.z; me.y = 0; me.yaw = sim.yaw; me.anim = 0;
  if (e.spot) e.spot.visible = S.head;
  setCarState(e.g, { steer: sim.steer, speed: sim.speed, brake: S.brake, head: S.head, dt, boost: sim.boost }); $('#nitro').classList.remove('hidden'); $('#nitro i').style.width = sim.nitro + '%';
  engineAudio(Math.abs(sim.speed) / sim.def.maxSpeed, inp.up ? 1 : 0, true, sim.boost);
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
  raceUpdate(now); if (frame % 6 === 0) drawMap();
}

let last = performance.now(), frame = 0;
function loop(now) {
  requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now; frame++; const t = now / 1000;
  if (S.inGame) {
    if (!S.panel || S.panel === 'pause') { if (S.mode === 'foot') footUpdate(dt, t); else driveUpdate(dt); } else if (S.mode === 'drive') driveUpdate(dt);
    npcStep(dt); updateRemotes(dt, t); updateCamera(dt, now); updateHud(now, frame);
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
