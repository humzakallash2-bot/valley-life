import * as THREE from 'three';
import { ROAD, BLOCKS, HOUSES, SPECIAL, HOME_SLOTS } from '/shared/config.js';

function rng(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeLabel(text, w = 4) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'); let fs = 44;
  g.font = `700 ${fs}px system-ui,sans-serif`;
  while (g.measureText(text).width > 470 && fs > 18) { fs -= 2; g.font = `700 ${fs}px system-ui,sans-serif`; }
  g.fillStyle = 'rgba(9,13,24,.72)'; g.beginPath(); g.roundRect(4, 12, 504, 72, 18); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 49);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(w, (w * 96) / 512, 1); s.renderOrder = 10; return s;
}

function facadeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#35506b';
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.fillRect(14 + i * 60, 14 + j * 60, 36, 36);
  g.fillStyle = 'rgba(255,235,160,.9)'; g.fillRect(14, 74, 36, 36);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildWorld(scene) {
  const R = rng(7), colliders = [], facade = facadeTex();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const addC = (x, z, w, d, h = 60) => colliders.push({ minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2, h });
  const box = (w, h, d, color, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color)); m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
  };

  // ground, roads, lane dashes, block slabs
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), std(0x4f8a3b)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.1; ground.receiveShadow = true; scene.add(ground);
  const roadCol = 0x34373d;
  for (const L of ROAD.lines) {
    box(400, 0.1, ROAD.width, roadCol, 0, -0.05, L, false).receiveShadow = true;
    box(ROAD.width, 0.1, 400, roadCol, L, -0.048, 0, false).receiveShadow = true;
  }
  const dashes = [];
  for (const L of ROAD.lines) for (let t = -196; t <= 196; t += 8) {
    if (ROAD.lines.some(l => Math.abs(l - t) < 9)) continue;
    dashes.push([t, L, 0], [L, t, 1]);
  }
  const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.02, 0.25), new THREE.MeshBasicMaterial({ color: 0xf2e9b8 }), dashes.length);
  const mtx = new THREE.Matrix4();
  dashes.forEach(([a, b, v], i) => { mtx.makeRotationY(v ? Math.PI / 2 : 0).setPosition(v ? a : a, 0.01, b); dash.setMatrixAt(i, mtx); });
  scene.add(dash);
  for (const bx of BLOCKS) for (const bz of BLOCKS) box(66, 0.1, 66, bz === 120 ? 0x5da34a : 0xb6b6b0, bx, -0.05, bz, false).receiveShadow = true;

  function building(x, z, w, d, h, color) {
    const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 8, (uv.getY(i) * h) / 8);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, map: facade, roughness: 0.8 }));
    m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    box(w + 0.4, 0.4, d + 0.4, 0x555a60, x, h + 0.2, z);
    addC(x, z, w, d, h); return m;
  }

  // special buildings
  for (const s of SPECIAL) {
    building(s.x, s.z, s.w, s.d, s.h, s.color);
    box(3.2, 2.7, 0.3, 0x20262e, s.x, 1.35, s.z + s.d / 2 + 0.1, false);
    const lab = makeLabel(s.label, 9); lab.position.set(s.x, s.h + 3, s.z + s.d / 2); scene.add(lab);
    if (s.id === 'gas') { // canopy + pumps
      box(18, 0.4, 10, 0xf2f2f2, s.x, 5.2, s.z + s.d / 2 + 7);
      for (const px of [-8, 8]) for (const pz of [3, 11]) { box(0.4, 5, 0.4, 0x999999, s.x + px, 2.5, s.z + pz + 3); addC(s.x + px, s.z + pz + 3, 0.6, 0.6, 5); }
      box(1, 1.6, 0.6, 0xe53935, s.x - 3, 0.8, s.z + s.d / 2 + 7); box(1, 1.6, 0.6, 0xe53935, s.x + 3, 0.8, s.z + s.d / 2 + 7);
    }
    if (s.id === 'dealer') for (let i = -2; i <= 2; i++) box(3.2, 0.02, 5.5, 0xffffff, s.x + i * 4.6, 0.02, s.z + s.d / 2 + 12, false); // display bays
  }

  // downtown blocks
  for (const bx of BLOCKS) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (bx === -120) continue; // Valley Life Mart stands here
    const w = 18 + R() * 8, d = 18 + R() * 8, h = 12 + R() * 38;
    building(bx + sx * 17, -120 + sz * 17, w, d, h, new THREE.Color().setHSL(R(), 0.25 + R() * 0.2, 0.62 + R() * 0.15).getHex());
  }

  // houses
  const roofGeo = new THREE.ConeGeometry(0.72, 1, 4);
  for (const h of HOUSES) {
    const m = building(h.x, h.z, h.w, h.d, 5, h.color); m.material.map = null; m.material.needsUpdate = true;
    const roof = new THREE.Mesh(roofGeo, std(0x7a3b2e)); roof.scale.set(h.w * 1.08, 3.2, h.d * 1.08); roof.rotation.y = Math.PI / 4; roof.position.set(h.x, 5.4 + 1.6 - 0.4, h.z); roof.castShadow = true; scene.add(roof);
    box(1.8, 2.8, 0.3, 0x5b3a22, h.x, 1.4, h.z + h.face * (h.d / 2 + 0.1), false);
    for (const wx of [-4.5, 4.5]) box(2, 1.6, 0.3, 0x7fb4e8, h.x + wx, 2.6, h.z + h.face * (h.d / 2 + 0.1), false);
    const edge = h.face < 0 ? 87 : 153, start = h.z + h.face * (h.d / 2), len = Math.abs(edge - start);
    box(4, 0.06, len, 0x8a8d92, h.x + 4, 0.02, start + (edge - start) / 2, false);
    const lab = makeLabel(h.name, 5); lab.position.set(h.x, 10.5, h.z); scene.add(lab);
  }

  // trees (instanced) with trunk colliders
  const trees = [];
  for (const bx of BLOCKS) {
    for (const bz of [-40, 40]) for (const [ox, oz] of [[-31, -31], [31, -31], [-31, 31], [31, 31], [-31, 0], [31, 0]]) trees.push([bx + ox, bz + oz]);
    for (let i = 0; i < 8; i++) {
      const x = bx + (R() - 0.5) * 62, z = 120 + (R() - 0.5) * 62;
      if (!HOUSES.some(h => Math.abs(x - h.x) < h.w / 2 + 6 && Math.abs(z - h.z) < h.d / 2 + 6) && !HOUSES.some(h => Math.abs(x - (h.x + 4)) < 4 && Math.abs(z - h.z) < 30) && !HOME_SLOTS.some(h => Math.abs(x - h.x) < 12 && Math.abs(z - h.z) < 11)) trees.push([x, z]);
    }
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.32, 2.2, 6), std(0x6b4a2b), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 5, 8), std(0x2f7d3a), trees.length);
  trunk.castShadow = crown.castShadow = true;
  trees.forEach(([x, z], i) => {
    const s = 0.8 + R() * 0.6;
    mtx.makeScale(s, s, s).setPosition(x, 1.1 * s, z); trunk.setMatrixAt(i, mtx);
    mtx.makeScale(s, s, s).setPosition(x, 4.2 * s, z); crown.setMatrixAt(i, mtx);
    addC(x, z, 0.8, 0.8, 5);
  });
  scene.add(trunk, crown);

  // streetlights (instanced); lamp glow driven by time of day
  const lamps = [];
  for (const L of ROAD.lines) for (let t = -190; t <= 190; t += 40) {
    if (ROAD.lines.some(l => Math.abs(l - t) < 12)) continue;
    const s = (t / 40) % 2 === 0 ? 1 : -1;
    lamps.push([t, L + s * 8.5], [L + s * 8.5, t]);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 0 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), std(0x44484f), lamps.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 8, 6), lampMat, lamps.length);
  lamps.forEach(([x, z], i) => { mtx.makeTranslation(x, 3.5, z); poles.setMatrixAt(i, mtx); mtx.makeTranslation(x, 7.1, z); heads.setMatrixAt(i, mtx); });
  scene.add(poles, heads);

  // stop signs + road signs at intersection corners
  const signs = [];
  for (const x of ROAD.lines) for (const z of ROAD.lines) signs.push([x + 8.5, z + 8.5], [x - 8.5, z - 8.5]);
  const sp = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), std(0x888888), signs.length);
  const sf = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 8), std(0xc62828), signs.length);
  signs.forEach(([x, z], i) => { mtx.makeTranslation(x, 1.3, z); sp.setMatrixAt(i, mtx); mtx.makeRotationX(Math.PI / 2).setPosition(x, 2.7, z); sf.setMatrixAt(i, mtx); });
  scene.add(sp, sf);

  return { colliders, lampMat };
}

// A furnished interior room, built far from the town (x=1000+). Players are teleported inside.
export function buildInterior(scene, idx, colliders) {
  const ox = 1000 + idx * 40, oz = 1000, W = 16, D = 14, H = 4.2;
  const add = (w, h, d, x, y, z, c, solid = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    m.position.set(ox + x, y, oz + z); m.castShadow = m.receiveShadow = true; scene.add(m);
    if (solid) colliders.push({ minx: ox + x - w / 2, maxx: ox + x + w / 2, minz: oz + z - d / 2, maxz: oz + z + d / 2, h: 5 });
    return m;
  };
  add(W, 0.2, D, 0, -0.1, 0, 0xb98b5e);
  for (const [w, d, x, z] of [[W, 0.4, 0, -D / 2], [W, 0.4, 0, D / 2], [0.4, D, -W / 2, 0], [0.4, D, W / 2, 0]]) add(w, H, d, x, H / 2, z, 0xe9e2d3, true);
  add(6, 0.04, 4, 0, 0.02, -3.5, 0x8a3b3b);                    // rug
  add(3.4, 1.7, 0.2, 0, 1.7, -D / 2 + 0.4, 0x111418, true);    // TV
  add(2.6, 0.5, 1.2, 0, 0.25, -3.5, 0x6b4a2b, true);           // coffee table
  add(5, 0.9, 1.6, 0, 0.45, -1.2, 0x375a7f, true);             // couch
  add(5, 1.5, 0.4, 0, 1.0, -0.2, 0x2d4a68, true);
  add(3.2, 0.6, 4.4, 5.5, 0.3, 3.5, 0xa33a3a, true);           // bed
  add(1.4, 0.2, 0.8, 5.5, 0.7, 1.7, 0xffffff);
  add(1.2, 1, 6, -7, 0.5, 2, 0x8d6e4b, true);                  // kitchen counter
  add(3, 0.8, 1.6, -3, 0.4, 4, 0x6b4a2b, true);                // dining table
  add(0.3, 2, 0.3, -7.2, 1, -5.8, 0x333333);                   // lamp
  return { ox, oz, spawn: { x: ox, z: oz + D / 2 - 3.5 }, exit: { x: ox, z: oz + D / 2 - 1.4 } };
}

// Empty, recolourable room for a player home; furniture is added dynamically into room.fg
export function buildRoom(scene, ox, oz) {
  const W = 16, D = 14, H = 4.2, mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), cols = [];
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), mat(0xb98b5e)); floor.position.set(ox, -0.1, oz); floor.receiveShadow = true; scene.add(floor);
  const wm = mat(0xe9e2d3);
  for (const [w, d, x, z] of [[W, 0.4, 0, -D / 2], [W, 0.4, 0, D / 2], [0.4, D, -W / 2, 0], [0.4, D, W / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wm); m.position.set(ox + x, H / 2, oz + z); m.castShadow = m.receiveShadow = true; scene.add(m);
    cols.push({ minx: ox + x - w / 2, maxx: ox + x + w / 2, minz: oz + z - d / 2, maxz: oz + z + d / 2, h: 5 });
  }
  const fg = new THREE.Group(); scene.add(fg);
  return { ox, oz, floor, wm: wm, fg, cols, spawn: { x: ox, z: oz + D / 2 - 3.5 }, exit: { x: ox, z: oz + D / 2 - 1.4 } };
}
