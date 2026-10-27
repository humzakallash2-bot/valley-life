import * as THREE from 'three';
import { VEHICLES } from '/shared/config.js';

const glass = new THREE.MeshStandardMaterial({ color: 0x18222d, roughness: 0.15, metalness: 0.7 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 });
const WR = 0.38;

export function makeCar(type, color) {
  const d = VEHICLES[type], [w, h, l] = d.size;
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
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
  g.userData = { paint, wheels, headMat, tailMat };
  return g;
}

export function setCarState(g, { steer = 0, speed = 0, brake = false, head = false, dt = 0 }) {
  const u = g.userData;
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
  constructor(type, x, z, yaw) { this.def = VEHICLES[type]; this.x = x; this.z = z; this.yaw = yaw; this.speed = 0; this.steer = 0; this.hit = 0; }
  step(dt, inp, cols) {
    const d = this.def; let a = 0;
    if (inp.up) a = this.speed < -0.5 ? d.brake : d.accel * (1 - Math.max(this.speed, 0) / d.maxSpeed);
    else if (inp.down) a = this.speed > 0.5 ? -d.brake : -d.accel * 0.5 * (1 - Math.max(-this.speed, 0) / (d.maxSpeed * 0.3));
    else a = -Math.sign(this.speed) * Math.min(Math.abs(this.speed) / dt, 3 + Math.abs(this.speed) * 0.1);
    if (inp.brake) a = -Math.sign(this.speed) * Math.min(Math.abs(this.speed) / dt, d.brake * 1.4);
    this.speed = Math.max(-d.maxSpeed * 0.3, Math.min(d.maxSpeed, this.speed + a * dt));
    const lock = 1 - Math.min(Math.abs(this.speed) / d.maxSpeed, 1) * 0.65;
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
