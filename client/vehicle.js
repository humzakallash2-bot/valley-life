import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VEHICLES } from '/shared/config.js';

const MODEL = {};
const TRIM = { bmwsilver: 0xc0c4ca, bmwwhite: 0xf0f0f0, bmwblack: 0x111111, bmwblue: 0x1c4fa8, navy: 0x0b2a6b, 'white.002': 0xdfe9f5, glossy: 0x0a0a0a, 'red.002': 0xc4161c, orangebody: 0xff6a00 };
const PAINT = /carshell|bodypaint|carpaint|carbodymat|car texture|polar_white|orangebody|^navy$|white\.002|^glossy$/;
// The converted files lost many materials (plain white metal). Rebuild sensible ones from the material names.
function fixMat(m, v) {
  const n = (m.name || '').toLowerCase(), c = m.color, lost = c.r > 0.95 && c.g > 0.95 && c.b > 0.95 && (m.metalness ?? 0) > 0.9;
  const set = (h, me, ro) => { m.color.setHex(h); m.metalness = me; m.roughness = ro; };
  if (/red_glass|glas_red|red light|tailight|baclight|backligh|redlamps/.test(n)) { set(0x8a0c0c, 0.1, 0.2); m.emissive?.setHex(0x330000); }
  else if (/glass|glas|window|screen|translucent|tint|shining/.test(n) && !/head/.test(n)) { set(0x0a1118, 0.9, 0.05); m.transparent = true; m.opacity = 0.72; }
  else if (/head|lights_glass|angel/.test(n)) set(0xdfe6ee, 0.3, 0.08);
  else if (/tire|tyre|rubber/.test(n)) set(0x101010, 0, 0.9);
  else if (PAINT.test(n)) { m.color.setHex(TRIM[n] ?? (lost ? v.color : c.getHex())); m.metalness = 0.55; m.roughness = 0.28; }
  else if (/plate|schild/.test(n)) set(0xeeeeee, 0, 0.6);
  else if (/interior|seat|dashboard|lining/.test(n)) set(0x202020, 0, 0.8);
  else if (TRIM[n] !== undefined) set(TRIM[n], /bmwsilver/.test(n) ? 1 : 0.2, 0.3);
  else if (/chrome|rim|brake|disk|nut|alumin|silver|exhaust|metallic|callip|joint|holder|strip/.test(n)) { if (lost || c.r > 0.5) set(0xc9cdd3, 1, 0.22); else { m.metalness = 0.9; m.roughness = 0.3; } }
  else if (lost) set(0x1a1a1a, 0.2, 0.6);
  else { m.metalness = Math.min(m.metalness ?? 0, 0.5); m.roughness = Math.max(m.roughness ?? 0.5, 0.35); }
  m.emissiveIntensity = m.emissive && m.emissive.getHex() ? 0.6 : 0; m.needsUpdate = true;
}
export function loadModels() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(VEHICLES).filter(([, v]) => v.model).map(([k, v]) => new Promise(res => loader.load('/cars/' + v.model + '.glb', gltf => {
    const seen = new Set(); gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.envMapIntensity = 0.9; fixMat(o.material, v); } } });
    MODEL[k] = gltf.scene; res();
  }, undefined, () => res()))));
}

const glass = new THREE.MeshStandardMaterial({ color: 0x23323f, roughness: 0.1, metalness: 0.8 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 });
const WR = 0.38;

export function makeCar(type, color, kit = 0) {
  const d = VEHICLES[type], [w, h, l] = d.size;
  const g = new THREE.Group();
  const flameOf = () => { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85 })); fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0.55, -l / 2 - 0.9); fl.visible = false; g.add(fl); return fl; };
  if (MODEL[type]) { // real 3D model: static body, underglow with body kit level 3
    g.add(MODEL[type].clone(true));
    if (kit >= 3) { const u = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, l * 1.05), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.7 })); u.rotation.x = -Math.PI / 2; u.position.y = 0.06; g.add(u); }
    g.userData = { paint: { color: new THREE.Color() }, wheels: [], headMat: {}, tailMat: {}, flame: flameOf() };
    return g;
  }
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08 });
  const bodyH = h * 0.45, y0 = 0.38;
  const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  mk(new THREE.BoxGeometry(w, bodyH, l), paint, 0, y0 + bodyH / 2, 0);
  const cabL = l * d.cabin, cabH = h * 0.45;
  mk(new THREE.BoxGeometry(w * 0.9, cabH, cabL), glass, 0, y0 + bodyH + cabH / 2, -l * 0.06);
  mk(new THREE.BoxGeometry(w * 0.88, 0.07, cabL * 0.98), paint, 0, y0 + bodyH + cabH + 0.03, -l * 0.06);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1111, emissiveIntensity: 0.4 });
  for (const sx of [-1, 1]) {
    mk(new THREE.BoxGeometry(0.4, 0.2, 0.1), headMat, sx * w * 0.32, y0 + bodyH * 0.65, l / 2);
    mk(new THREE.BoxGeometry(0.4, 0.18, 0.1), tailMat, sx * w * 0.32, y0 + bodyH * 0.65, -l / 2);
  }
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * (w / 2 - 0.08), WR, sz * l * 0.32);
    const spin = new THREE.Group(); pivot.add(spin);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(WR, WR, 0.3, 16), tireMat); tire.rotation.z = Math.PI / 2; tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(WR * 0.6, WR * 0.6, 0.32, 8), rimMat); rim.rotation.z = Math.PI / 2;
    spin.add(tire, rim); g.add(pivot);
    wheels.push({ pivot, spin, front: sz > 0 });
  }
  if (type === 'sports' || type === 'hyper') mk(new THREE.BoxGeometry(w * 0.16, 0.02, l * 0.98), new THREE.MeshStandardMaterial({ color: 0xffffff }), 0, y0 + bodyH + 0.02, 0);
  if (kit >= 1) { mk(new THREE.BoxGeometry(w * 0.95, 0.06, 0.5), paint, 0, y0 + bodyH + cabH + 0.35, -l / 2 + 0.2); for (const sx of [-1, 1]) mk(new THREE.BoxGeometry(0.06, 0.35, 0.3), glass, sx * w * 0.4, y0 + bodyH + cabH + 0.15, -l / 2 + 0.2); }
  if (kit >= 2) { mk(new THREE.BoxGeometry(w + 0.1, 0.1, 0.45), glass, 0, 0.22, l / 2); for (const sx of [-1, 1]) mk(new THREE.BoxGeometry(0.1, 0.16, l * 0.5), glass, sx * (w / 2 + 0.02), 0.34, 0); }
  if (kit >= 3) { const u = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, l * 1.05), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.7 })); u.rotation.x = -Math.PI / 2; u.position.y = 0.06; g.add(u); }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85 }));
  flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0.55, -l / 2 - 0.9); flame.visible = false; g.add(flame);
  g.userData = { paint, wheels, headMat, tailMat, flame };
  return g;
}

export function setCarState(g, { steer = 0, speed = 0, brake = false, head = false, dt = 0, boost = false }) {
  const u = g.userData; u.flame.visible = boost; if (boost) u.flame.scale.y = 0.8 + Math.random() * 0.6;
  for (const w of u.wheels) { w.spin.rotation.x += (speed * dt) / WR; if (w.front) w.pivot.rotation.y = steer * 0.5; }
  u.tailMat.emissiveIntensity = brake ? 3 : head ? 1 : 0.4;
  u.headMat.emissiveIntensity = head ? 3 : 0.2;
}

// Push circle p={x,z} out of AABB colliders. Returns true if anything was hit.
export function resolveCircle(p, r, cols) {
  let hit = false;
  for (const c of cols) {
    const cx = Math.max(c.minx, Math.min(p.x, c.maxx)), cz = Math.max(c.minz, Math.min(p.z, c.maxz));
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
    else {
      const l = p.x - c.minx, rr = c.maxx - p.x, t = p.z - c.minz, b = c.maxz - p.z, m = Math.min(l, rr, t, b);
      if (m === l) p.x = c.minx - r; else if (m === rr) p.x = c.maxx + r; else if (m === t) p.z = c.minz - r; else p.z = c.maxz + r;
    }
    hit = true;
  }
  return hit;
}

// Arcade bicycle-model physics: forward heading = (sin yaw, cos yaw); +yaw turns left.
export class VehicleSim {
  constructor(type, x, z, yaw, m = {}) {
    const b = VEHICLES[type], e = m.engine | 0, br = m.brakes | 0;
    this.def = { ...b, maxSpeed: b.maxSpeed * (1 + 0.06 * e), accel: b.accel * (1 + 0.12 * e), brake: b.brake * (1 + 0.12 * br) };
    this.lockK = 0.65 - 0.07 * (m.tires | 0); this.nl = m.nitro | 0; this.nitro = 100; this.boost = false; this.x = x; this.z = z; this.yaw = yaw; this.speed = 0; this.steer = 0; this.hit = 0; }
  step(dt, inp, cols) {
    const d = this.def; let a = 0;
    this.boost = !!inp.nitro && this.nitro > 1 && !!inp.up;
    this.nitro = this.boost ? this.nitro - (30 / (1 + 0.35 * this.nl)) * dt : Math.min(100, this.nitro + 6 * dt);
    const mx = d.maxSpeed * (this.boost ? 1.25 : 1), ac = d.accel * (this.boost ? 1.9 : 1);
    if (inp.up) a = this.speed < -0.5 ? d.brake : ac * (1 - Math.max(this.speed, 0) / mx);
    else if (inp.down) a = this.speed > 0.5 ? -d.brake : -d.accel * 0.5 * (1 - Math.max(-this.speed, 0) / (d.maxSpeed * 0.3));
    else a = -Math.sign(this.speed) * Math.min(Math.abs(this.speed) / dt, 3 + Math.abs(this.speed) * 0.1);
    if (inp.brake) a = -Math.sign(this.speed) * Math.min(Math.abs(this.speed) / dt, d.brake * 1.4);
    this.speed = Math.max(-d.maxSpeed * 0.3, Math.min(mx, this.speed + a * dt));
    const lock = 1 - Math.min(Math.abs(this.speed) / d.maxSpeed, 1) * this.lockK;
    const target = ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * lock;
    this.steer += (target - this.steer) * Math.min(1, 7 * dt);
    this.yaw += (this.speed / 2.8) * Math.tan(this.steer * d.turn) * dt;
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
    // collide with three circles along the body
    const l = d.size[2], r = d.size[0] * 0.5; let hit = false;
    for (const off of [l * 0.32, 0, -l * 0.32]) {
      const c = { x: this.x + Math.sin(this.yaw) * off, z: this.z + Math.cos(this.yaw) * off }, bx = c.x, bz = c.z;
      if (resolveCircle(c, r, cols)) { this.x += c.x - bx; this.z += c.z - bz; hit = true; }
    }
    this.hit = hit ? Math.abs(this.speed) : 0;
    if (hit) this.speed *= 0.55;
  }
}
