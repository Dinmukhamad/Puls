/** Original, metre-scale watercraft. X is forward, Y is up. No external assets. */
export const MODELS = [
  { id: 'speedboat', name: 'Прогулочный катер', category: 'boats', type: 'Боурайдер · 6,2 м', description: 'Открытый прогулочный катер с носовым диваном, двойным ветровым стеклом и подвесным мотором.', defaultColor: '#125b78' },
  { id: 'fishing-boat', name: 'Рыболовный катер', category: 'boats', type: 'Пилотхаус · 8,1 м', description: 'Морской катер с закрытой рубкой, проходными бортами, кормовым кокпитом и двумя подвесными моторами.', defaultColor: '#245f6c' },
  { id: 'cabin-boat', name: 'Каютный круизер', category: 'boats', type: 'Круизер · 9,6 м', description: 'Каютный катер с панорамным остеклением, носовой лежанкой, кормовым диваном и купальной платформой.', defaultColor: '#24384c' },
  { id: 'motor-yacht', name: 'Моторная яхта', category: 'yachts', type: 'Флайбридж · 18 м', description: 'Двухпалубная моторная яхта с открытым флайбриджем, салоном, тиковой палубой и купальной платформой.', defaultColor: '#e8edf0' },
  { id: 'sailing-yacht', name: 'Парусная яхта', category: 'yachts', type: 'Шлюп · 12,2 м', description: 'Одномачтовая круизная яхта: грот и стаксель, стоячий такелаж, киль, штурвал и палубные лебёдки.', defaultColor: '#eff1ed' },
  { id: 'sport-yacht', name: 'Спортивная яхта', category: 'yachts', type: 'Хардтоп · 14,2 м', description: 'Скоростная яхта с низкой надстройкой, закрытым хардтопом, широким кокпитом и носовым солярием.', defaultColor: '#244859' },
];

export function buildModel(THREE, id) {
  const info = MODELS.find(m => m.id === id);
  if (!info) throw new Error(`Unknown marine model: ${id}`);
  const B = new Builder(THREE, info);
  if (id === 'speedboat') speedboat(B);
  if (id === 'fishing-boat') fishingBoat(B);
  if (id === 'cabin-boat') cabinBoat(B);
  if (id === 'motor-yacht') motorYacht(B);
  if (id === 'sailing-yacht') sailingYacht(B);
  if (id === 'sport-yacht') sportYacht(B);
  return B.finish();
}

class Builder {
  constructor(T, info) {
    this.T = T; this.info = info; this.batches = new Map();
    const physical = (color, options = {}) => new T.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.05, ...options });
    this.mat = {
      paint: physical(info.defaultColor, { roughness: 0.24, metalness: 0.16, clearcoat: 1, clearcoatRoughness: 0.15 }),
      white: physical('#f5f3e9', { clearcoat: 0.65 }),
      roof: physical('#e1e7e4', { metalness: 0.18, roughness: 0.28 }),
      dark: physical('#17232a', { roughness: 0.34, clearcoat: 0.6 }),
      rubber: physical('#1b2020', { roughness: 0.85, metalness: 0 }),
      steel: physical('#aabcc0', { metalness: 0.92, roughness: 0.2 }),
      teak: physical('#ac7f4d', { roughness: 0.67 }),
      teakLight: physical('#bc9566', { roughness: 0.7 }),
      teakDark: physical('#292b28', { roughness: 0.82 }),
      cushion: physical('#e9ded0', { roughness: 0.82 }),
      seatEdge: physical('#bcae99', { roughness: 0.78 }),
      glass: physical('#588494', { metalness: 0.12, roughness: 0.10, transparent: true, opacity: 0.64, depthWrite: false, side: T.DoubleSide, clearcoat: 1 }),
      blackGlass: physical('#122e3b', { metalness: 0.25, roughness: 0.11, transparent: true, opacity: 0.81, side: T.DoubleSide, clearcoat: 1 }),
      red: physical('#b52324', { roughness: 0.25, emissive: '#6c0806', emissiveIntensity: 0.25 }),
      green: physical('#148c61', { roughness: 0.25, emissive: '#044d30', emissiveIntensity: 0.25 }),
      lamp: physical('#f5ecd2', { roughness: 0.18, emissive: '#f5dba0', emissiveIntensity: 0.3 }),
      rope: physical('#c7c2ae', { roughness: 0.95 }),
      sail: physical('#f7f3e8', { roughness: 0.86, side: T.DoubleSide }),
      seam: physical('#b6b4a9', { roughness: 0.96 }),
      bronze: physical('#a58339', { roughness: 0.34, metalness: 0.85 }),
    };
    this.mat.paint.userData.paint = true;
  }
  add(geometry, material, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    const T = this.T;
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(...p), new T.Quaternion().setFromEuler(new T.Euler(...r)), new T.Vector3(...s)));
    if (!this.batches.has(material)) this.batches.set(material, []);
    this.batches.get(material).push(g);
    geometry.dispose();
  }
  box(p, s, m = this.mat.white, radius = 0) {
    if (!radius) return this.add(new this.T.BoxGeometry(...s), m, p);
    const [w, h, d] = s, rr = Math.min(radius, w / 2.1, h / 2.1, d / 2.1);
    const shape = new this.T.Shape();
    const x = -w / 2 + rr, y = -h / 2 + rr, a = w - 2 * rr, b = h - 2 * rr;
    shape.moveTo(x, y - rr); shape.lineTo(x + a, y - rr); shape.quadraticCurveTo(x + a + rr, y - rr, x + a + rr, y);
    shape.lineTo(x + a + rr, y + b); shape.quadraticCurveTo(x + a + rr, y + b + rr, x + a, y + b + rr);
    shape.lineTo(x, y + b + rr); shape.quadraticCurveTo(x - rr, y + b + rr, x - rr, y + b);
    shape.lineTo(x - rr, y); shape.quadraticCurveTo(x - rr, y - rr, x, y - rr);
    const g = new this.T.ExtrudeGeometry(shape, { depth: d - 2 * rr, bevelEnabled: true, bevelThickness: rr, bevelSize: rr * 0.35, bevelSegments: 2, steps: 1, curveSegments: 4 });
    g.translate(0, 0, -d / 2 + rr);
    this.add(g, m, p);
  }
  sphere(p, s, m = this.mat.white, n = 16) { this.add(new this.T.SphereGeometry(1, n, 10), m, p, [0, 0, 0], s); }
  cylinder(a, b, radius, m = this.mat.steel, radial = 10, radius2 = radius) {
    const T = this.T, va = new T.Vector3(...a), vb = new T.Vector3(...b), direction = vb.clone().sub(va);
    if (direction.length() < 1e-5) return;
    const g = new T.CylinderGeometry(radius2, radius, direction.length(), radial, 1);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction.clone().normalize()));
    g.translate(...va.add(vb).multiplyScalar(0.5).toArray());
    this.add(g, m);
  }
  tube(points, radius, m = this.mat.steel, segments = 0, closed = false) {
    const T = this.T;
    if (points.length < 2) return;
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)), closed, 'centripetal', 0.3);
    this.add(new T.TubeGeometry(curve, segments || Math.max(8, points.length * 4), radius, 7, closed), m);
  }
  panel(points, material, thickness = 0) {
    const T = this.T, pos = [], n = points.length;
    for (let j = 1; j < n - 1; j++) pos.push(...points[0], ...points[j], ...points[j + 1]);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); this.add(g, material);
    if (thickness) this.tube([...points, points[0]], thickness, this.mat.steel);
  }
  prism(points, bottom, height, material) {
    const T = this.T, shape = new T.Shape(points.map(([x, z]) => new T.Vector2(x, -z)));
    const g = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 }); g.rotateX(-Math.PI / 2); this.add(g, material, [0, bottom, 0]);
  }
  finish() {
    const T = this.T, group = new T.Group();
    for (const [material, geometries] of this.batches) {
      let count = 0; for (const g of geometries) count += g.getAttribute('position').array.length;
      const positions = new Float32Array(count), normals = new Float32Array(count); let offset = 0;
      for (const g of geometries) { positions.set(g.getAttribute('position').array, offset); normals.set(g.getAttribute('normal').array, offset); offset += g.getAttribute('position').array.length; g.dispose(); }
      const merged = new T.BufferGeometry(); merged.setAttribute('position', new T.BufferAttribute(positions, 3)); merged.setAttribute('normal', new T.BufferAttribute(normals, 3)); merged.computeBoundingSphere();
      const mesh = new T.Mesh(merged, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = Object.entries(this.mat).find(([, m]) => m === material)?.[0] || 'fittings'; group.add(mesh);
    }
    const bounds = new T.Box3().setFromObject(group), center = bounds.getCenter(new T.Vector3());
    group.position.set(-center.x, -bounds.min.y, -center.z);
    // Bake the final translation so model-local coordinates themselves are grounded.
    for (const mesh of group.children) mesh.geometry.translate(...group.position.toArray());
    group.position.set(0, 0, 0);
    group.userData = { id: this.info.id, name: this.info.name, units: 'meters', lengthAxis: 'X', bow: '+X' };
    group.name = this.info.name;
    return group;
  }
}

// Smooth, sealed loft: a rounded V bottom, flared sides, crowned deck and two closed ends.
function hull(B, length, beam, depth, options = {}) {
  const T = B.T, stations = 104, lower = 44, upper = 16, ring = lower + upper, pos = [], indices = [];
  const sheer = options.sheer ?? 0.2;
  const widthAt = x => {
    const u = x / length + 0.5;
    if (u < 0.35) return beam / 2 * (0.84 + 0.16 * Math.sin(u / 0.35 * Math.PI / 2));
    const v = (u - 0.35) / 0.65;
    return beam / 2 * Math.max(0.008, Math.pow(Math.cos(v * Math.PI / 2), 0.72));
  };
  const topAt = x => depth + sheer * Math.pow((x / length + 0.5), 3) + 0.04 * Math.pow(0.5 - x / length, 2);
  for (let i = 0; i <= stations; i++) {
    const u = i / stations, x = (u - 0.5) * length, w = widthAt(x), top = topAt(x);
    const keel = 0.10 * Math.pow(1 - u, 3) + depth * 0.80 * Math.pow(Math.max(0, (u - 0.65) / 0.35), 3);
    for (let j = 0; j < lower; j++) {
      const a = j / lower * Math.PI;
      pos.push(x, keel + (top - keel) * (1 - Math.pow(Math.sin(a), options.vPower ?? 2.15)), Math.cos(a) * w);
    }
    for (let j = 0; j < upper; j++) {
      const u2 = j / upper;
      pos.push(x, top + 0.04 * Math.sin(u2 * Math.PI), -w + 2 * w * u2);
    }
  }
  for (let i = 0; i < stations; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b = (i + 1) * ring + j, c = (i + 1) * ring + (j + 1) % ring, d = i * ring + (j + 1) % ring;
    indices.push(a, c, b, a, d, c);
  }
  for (const end of [0, stations]) {
    const center = pos.length / 3, x = (end / stations - 0.5) * length;
    let meanY = 0; for (let j = 0; j < ring; j++) meanY += pos[(end * ring + j) * 3 + 1];
    pos.push(x, meanY / ring, 0);
    for (let j = 0; j < ring; j++) {
      const a = end * ring + j, b = end * ring + (j + 1) % ring;
      if (!end) indices.push(center, b, a); else indices.push(center, a, b);
    }
  }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(indices); geo.computeVertexNormals(); B.add(geo, B.mat.paint);
  // Raised white coaming and dark protective rubbing strake follow the actual hull outline.
  for (const side of [-1, 1]) {
    const line = [], rubber = [], waterline = [];
    for (let i = 0; i <= 48; i++) { const x = (i / 48 - 0.5) * length; line.push([x, topAt(x) + 0.025, side * widthAt(x)]); rubber.push([x, topAt(x) - 0.10, side * (widthAt(x) + 0.012)]); waterline.push([x, topAt(x) - depth * 0.67, side * widthAt(x) * 0.80]); }
    B.tube(line, 0.045, B.mat.white, 120); B.tube(rubber, 0.029, B.mat.rubber, 120);
    if (options.waterline !== false) B.tube(waterline, 0.018, B.mat.white, 100);
  }
  B.box([-length / 2 + 0.035, topAt(-length / 2) + 0.02, 0], [0.11, 0.11, beam * 0.84], B.mat.white, 0.025);
  const result = { length, beam, depth, widthAt, topAt, deck: depth + 0.08 };
  B.hullSpec = result;
  return result;
}

function deckPatch(B, x0, x1, width, y, shape = 'rect') {
  const edge = 0.065;
  let outline = [[x0, -width / 2], [x1, -width / 2], [x1, width / 2], [x0, width / 2]];
  if (shape === 'bow') outline = [[x0, -width / 2], [x1 - 0.25, -0.26], [x1, 0], [x1 - 0.25, 0.26], [x0, width / 2]];
  const H = B.hullSpec;
  const clipHull = H && x0 >= -H.length / 2 && x1 <= H.length / 2 && x1 > H.length * 0.30 && x0 < -H.length * 0.20;
  if (clipHull) {
    const port = [], starboard = [];
    for (let j = 0; j <= 36; j++) { const x = x0 + (x1 - x0) * j / 36, w = Math.min(width / 2, H.widthAt(x) - 0.075); port.push([x, -w]); starboard.push([x, w]); }
    outline = [...port, ...starboard.reverse()];
  }
  B.prism(outline, y, 0.035, B.mat.teakDark);
  const spacing = 0.13;
  for (let z = -width / 2 + spacing / 2; z < width / 2; z += spacing) {
    let tip = shape === 'bow' ? x1 - 0.15 - Math.abs(z) / (width / 2) * (x1 - x0 - 0.1) : x1;
    if (clipHull && H.widthAt(tip) < Math.abs(z) + 0.085) {
      let a = x0, b = tip; for (let j = 0; j < 18; j++) { const mid = (a + b) / 2; if (H.widthAt(mid) >= Math.abs(z) + 0.085) a = mid; else b = mid; } tip = a;
    }
    if (tip - x0 > 0.10) B.box([(x0 + tip) / 2, y + 0.04, z], [tip - x0 - edge, 0.025, spacing - 0.008], (Math.round(z / spacing) % 3 ? B.mat.teak : B.mat.teakLight));
  }
}

function cleat(B, x, y, z, scale = 1) {
  B.box([x, y, z], [0.23 * scale, 0.035 * scale, 0.075 * scale], B.mat.steel, 0.012);
  for (const k of [-1, 1]) B.cylinder([x + k * 0.06 * scale, y, z], [x + k * 0.06 * scale, y + 0.10 * scale, z], 0.023 * scale);
  B.cylinder([x - 0.16 * scale, y + 0.10 * scale, z], [x + 0.16 * scale, y + 0.10 * scale, z], 0.027 * scale);
}

function rails(B, H, x0, x1, height = 0.65, step = 1.0, inset = 0.10) {
  for (const side of [-1, 1]) {
    const points = [], low = [];
    for (let i = 0; i <= 40; i++) { const x = x0 + (x1 - x0) * i / 40, z = side * Math.max(0.05, H.widthAt(x) - inset), y = H.topAt(x); points.push([x, y + height, z]); low.push([x, y + height * 0.48, z]); }
    B.tube(points, 0.022, B.mat.steel, 100); if (height > 0.55) B.tube(low, 0.012, B.mat.steel, 90);
    for (let x = x0; x < x1; x += step) { const z = side * Math.max(0.06, H.widthAt(x) - inset), y = H.topAt(x); B.cylinder([x, y + 0.03, z], [x, y + height, z], 0.023); B.box([x, y + 0.035, z], [0.10, 0.03, 0.08], B.mat.steel, 0.01); }
  }
  const xb = x1, w = H.widthAt(xb) - inset, y = H.topAt(xb) + height;
  if (w > 0) B.tube([[xb, y, -w], [xb + 0.12, y + 0.03, 0], [xb, y, w]], 0.022);
}

function fittings(B, H, options = {}) {
  const { length: L, beam: W } = H;
  for (const x of [-L * 0.40, 0, L * 0.32]) for (const side of [-1, 1]) cleat(B, x, H.topAt(x) + 0.075, side * (H.widthAt(x) - 0.16), L > 13 ? 1.35 : 1);
  // Bow roller, articulated anchor, and several actual chain links.
  const x = L * 0.46, y = H.topAt(x) + 0.12;
  B.box([x, y, 0], [0.52, 0.065, 0.16], B.mat.steel, 0.02);
  B.cylinder([x + 0.27, y + 0.02, -0.11], [x + 0.27, y + 0.02, 0.11], 0.065, B.mat.rubber);
  B.cylinder([x + 0.11, y - 0.05, 0], [x + 0.35, y - 0.43, 0], 0.028);
  B.tube([[x + 0.13, y - 0.44, -0.2], [x + 0.35, y - 0.43, 0], [x + 0.37, y - 0.24, 0.2]], 0.04);
  for (let i = 0; i < 9; i++) { const g = new B.T.TorusGeometry(0.031, 0.009, 5, 10); B.add(g, B.mat.steel, [x - 0.07 - i * 0.044, y + 0.025, 0], i % 2 ? [Math.PI / 2, 0, 0] : [0, 0, 0]); }
  B.cylinder([x - 0.59, y, 0], [x - 0.59, y + 0.13, 0], 0.11);
  for (const s of [-1, 1]) { const xp = options.navX ?? L * 0.15; B.box([xp, H.topAt(xp) + 0.18, s * (H.widthAt(xp) - 0.06)], [0.16, 0.09, 0.07], s === 1 ? B.mat.green : B.mat.red, 0.025); }
  // Recessed circular hull portlights with stainless bezels.
  if (options.portholes !== false) for (const side of [-1, 1]) for (let k = 0; k < (options.ports ?? 4); k++) {
    const xp = -L * 0.21 + k * L * 0.12, z = side * (H.widthAt(xp) * 0.985 + 0.01), yy = H.topAt(xp) - 0.31;
    B.add(new B.T.TorusGeometry(L > 13 ? 0.115 : 0.09, 0.018, 7, 20), B.mat.steel, [xp, yy, z]);
    B.add(new B.T.CircleGeometry(L > 13 ? 0.112 : 0.086, 22), B.mat.blackGlass, [xp, yy, z + side * 0.002]);
  }
}

function seat(B, x, y, z, width = 0.55, facing = 1) {
  B.cylinder([x, y - 0.28, z], [x, y - 0.02, z], 0.065);
  B.box([x, y, z], [0.57, 0.14, width], B.mat.cushion, 0.055);
  B.box([x - facing * 0.23, y + 0.26, z], [0.13, 0.53, width], B.mat.cushion, 0.065);
  B.box([x - facing * 0.20, y + 0.55, z], [0.14, 0.16, width * 0.72], B.mat.cushion, 0.05);
  for (const s of [-1, 1]) { B.cylinder([x - facing * 0.17, y + 0.13, z + s * width * 0.48], [x + facing * 0.15, y + 0.13, z + s * width * 0.48], 0.025); B.box([x, y + 0.18, z + s * width * 0.5], [0.36, 0.07, 0.07], B.mat.cushion, 0.02); }
  B.tube([[x + 0.15, y + 0.076, z - width * 0.4], [x + 0.15, y + 0.076, z + width * 0.4]], 0.007, B.mat.seatEdge);
}

function bench(B, x, y, z, length, depth = 0.55, facing = 1, along = 'z') {
  const sx = along === 'z' ? depth : length, sz = along === 'z' ? length : depth;
  B.box([x, y - 0.16, z], [sx, 0.38, sz], B.mat.white, 0.06);
  B.box([x, y + 0.075, z], [sx + 0.025, 0.14, sz + 0.025], B.mat.cushion, 0.055);
  if (along === 'z') B.box([x - facing * depth * 0.43, y + 0.30, z], [0.13, 0.43, length], B.mat.cushion, 0.05);
  else B.box([x, y + 0.30, z - facing * depth * 0.43], [length, 0.43, 0.13], B.mat.cushion, 0.05);
  const n = Math.max(2, Math.floor(length / 0.45));
  for (let j = 1; j < n; j++) if (along === 'z') B.tube([[x - sx * 0.35, y + 0.15, z - length / 2 + j * length / n], [x + sx * 0.35, y + 0.15, z - length / 2 + j * length / n]], 0.006, B.mat.seatEdge); else B.tube([[x - length / 2 + j * length / n, y + 0.15, z - sz * 0.35], [x - length / 2 + j * length / n, y + 0.15, z + sz * 0.35]], 0.006, B.mat.seatEdge);
}

function helm(B, x, y, z, size = 1) {
  B.box([x, y + 0.2 * size, z], [0.50 * size, 0.45 * size, 0.57 * size], B.mat.white, 0.07 * size);
  B.box([x - 0.06 * size, y + 0.45 * size, z], [0.47 * size, 0.055 * size, 0.54 * size], B.mat.dark, 0.03);
  B.box([x - 0.08 * size, y + 0.49 * size, z - 0.10 * size], [0.19 * size, 0.024 * size, 0.24 * size], B.mat.blackGlass, 0.015);
  for (let k = 0; k < 3; k++) B.sphere([x - 0.08 * size, y + 0.49 * size, z + (0.08 + k * 0.06) * size], [0.022 * size, 0.014 * size, 0.022 * size], B.mat.steel, 10);
  const center = [x - 0.30 * size, y + 0.28 * size, z];
  B.add(new B.T.TorusGeometry(0.19 * size, 0.023 * size, 8, 28), B.mat.rubber, center, [0, Math.PI / 2, 0]);
  B.cylinder([center[0] - 0.03, center[1], z], [x, center[1], z], 0.035 * size);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; B.cylinder(center, [center[0], center[1] + Math.cos(a) * 0.18 * size, z + Math.sin(a) * 0.18 * size], 0.011 * size); }
  B.cylinder([x - 0.15 * size, y + 0.38 * size, z + 0.35 * size], [x - 0.06 * size, y + 0.60 * size, z + 0.35 * size], 0.018 * size); B.sphere([x - 0.06 * size, y + 0.60 * size, z + 0.35 * size], [0.04, 0.035, 0.035], B.mat.rubber, 10);
}

function outboard(B, x, y, z, scale = 1) {
  B.box([x + 0.20 * scale, y + 0.15 * scale, z], [0.23 * scale, 0.53 * scale, 0.32 * scale], B.mat.steel, 0.04);
  B.box([x, y + 0.36 * scale, z], [0.56 * scale, 0.66 * scale, 0.40 * scale], B.mat.dark, 0.11 * scale);
  B.box([x - 0.10 * scale, y + 0.57 * scale, z], [0.38 * scale, 0.10 * scale, 0.34 * scale], B.mat.rubber, 0.04);
  B.box([x - 0.02 * scale, y - 0.26 * scale, z], [0.19 * scale, 0.67 * scale, 0.16 * scale], B.mat.dark, 0.05 * scale);
  B.box([x - 0.05 * scale, y - 0.47 * scale, z], [0.44 * scale, 0.035 * scale, 0.39 * scale], B.mat.dark, 0.01);
  B.sphere([x - 0.10 * scale, y - 0.63 * scale, z], [0.24 * scale, 0.10 * scale, 0.11 * scale], B.mat.dark);
  B.cylinder([x - 0.16 * scale, y - 0.63 * scale, z], [x - 0.35 * scale, y - 0.63 * scale, z], 0.05 * scale, B.mat.steel);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; const g = new B.T.SphereGeometry(1, 12, 6); B.add(g, B.mat.steel, [x - 0.34 * scale, y - 0.63 * scale + Math.cos(a) * 0.13 * scale, z + Math.sin(a) * 0.13 * scale], [a, 0.22, 0.25], [0.028 * scale, 0.14 * scale, 0.055 * scale]); }
  B.tube([[x + 0.19 * scale, y + 0.20 * scale, z - 0.15 * scale], [x + 0.4 * scale, y + 0.30 * scale, z - 0.22 * scale], [x + 0.50 * scale, y + 0.18 * scale, z - 0.22 * scale]], 0.018 * scale, B.mat.rubber);
  for (let k = 0; k < 4; k++) B.box([x - 0.285 * scale, y + (0.26 + k * 0.055) * scale, z], [0.012 * scale, 0.018 * scale, 0.25 * scale], B.mat.steel);
}

function swimPlatform(B, H, extension = 0.65, widthFactor = 0.76) {
  const x = -H.length / 2 - extension / 2 + 0.08, y = H.deck - 0.10, width = H.beam * widthFactor;
  B.box([x, y - 0.08, 0], [extension, 0.13, width], B.mat.white, 0.05);
  deckPatch(B, x - extension / 2 + 0.06, x + extension / 2 - 0.03, width - 0.12, y, 'rect');
  for (const z of [-width / 2 + 0.15, -width / 2 + 0.49]) B.tube([[x - extension / 2 + 0.12, y + 0.08, z], [x - extension / 2 - 0.08, y + 0.10, z], [x - extension / 2 - 0.15, y - 0.55, z]], 0.025);
  for (let j = 0; j < 3; j++) B.cylinder([x - extension / 2 - 0.15, y - 0.14 - j * 0.18, -width / 2 + 0.15], [x - extension / 2 - 0.15, y - 0.14 - j * 0.18, -width / 2 + 0.49], 0.022);
}

function cabin(B, back, front, base, roofY, width, options = {}) {
  const m = B.mat, rake = options.rake ?? 0.36, topFront = front - rake, topBack = back + 0.12;
  B.box([(back + front) / 2, base + 0.12, 0], [front - back, 0.24, width], m.white, 0.065);
  const profile = [[back, base + 0.10], [front, base + 0.10], [topFront, roofY], [topBack, roofY]];
  // Side walls consist of a sill, continuous framed glass and slender roof pillars.
  for (const side of [-1, 1]) {
    const z = side * width / 2;
    const glass = [[back + 0.08, base + 0.28, z], [front - 0.12, base + 0.28, z], [topFront - 0.08, roofY - 0.11, z], [topBack + 0.06, roofY - 0.11, z]];
    B.panel(glass, options.darkGlass ? m.blackGlass : m.glass); B.tube([...glass, glass[0]], 0.035, m.white);
    const length = front - back;
    for (let k = 1; k < (options.windows ?? 3); k++) {
      const t = k / (options.windows ?? 3); B.cylinder([back + length * t, base + 0.28, z], [topBack + (topFront - topBack) * t, roofY - 0.08, z], options.slim ? 0.025 : 0.046, m.white);
    }
    B.box([(back + front) / 2, base + 0.18, z], [front - back - 0.1, 0.09, 0.05], m.steel, 0.02);
  }
  const frontGlass = [[front - 0.1, base + 0.29, -width * 0.47], [front - 0.1, base + 0.29, width * 0.47], [topFront, roofY - 0.10, width * 0.47], [topFront, roofY - 0.10, -width * 0.47]];
  B.panel(frontGlass, options.darkGlass ? m.blackGlass : m.glass); B.tube([...frontGlass, frontGlass[0]], 0.045, m.white);
  B.cylinder([front - 0.1, base + 0.29, 0], [topFront, roofY - 0.10, 0], 0.035, m.white);
  for (const s of [-1, 1]) B.tube([[front - 0.08, base + 0.34, s * width * 0.23], [front - rake * 0.45 - 0.02, base + (roofY - base) * 0.60, s * width * 0.17], [front - rake * 0.60 - 0.02, base + (roofY - base) * 0.73, s * width * 0.32]], 0.012, m.rubber);
  // A framed glazed aft bulkhead, including door and handle.
  B.panel([[back + 0.01, base + 0.25, -width * 0.46], [back + 0.01, base + 0.25, width * 0.46], [topBack, roofY - 0.10, width * 0.46], [topBack, roofY - 0.10, -width * 0.46]], m.glass);
  for (const z of [-width * 0.46, -0.30, 0.30, width * 0.46]) B.cylinder([back + 0.01, base + 0.25, z], [topBack, roofY - 0.09, z], 0.028, m.white);
  B.cylinder([back - 0.04, base + 0.64, 0.23], [back - 0.04, base + 0.83, 0.23], 0.016, m.steel);
  const roof = [[topBack - 0.18, -width / 2 - 0.10], [topFront + 0.13, -width / 2 - 0.10], [topFront + 0.24, 0], [topFront + 0.13, width / 2 + 0.10], [topBack - 0.18, width / 2 + 0.10]];
  B.prism(roof, roofY, 0.13, m.white);
  B.box([(topBack + topFront) / 2, roofY + 0.145, 0], [Math.min(1.0, (topFront - topBack) * 0.44), 0.025, width * 0.55], m.blackGlass, 0.08);
  return { back, front, roofY, width };
}

function radar(B, x, y, width = 0.9) {
  B.cylinder([x, y, 0], [x, y + 0.22, 0], 0.06, B.mat.white);
  B.box([x, y + 0.28, 0], [0.24, 0.15, width], B.mat.white, 0.06);
  B.cylinder([x + 0.20, y, 0], [x + 0.20, y + 0.70, 0], 0.025);
  B.sphere([x + 0.20, y + 0.72, 0], [0.05, 0.09, 0.05], B.mat.lamp);
}

function speedboat(B) {
  const H = hull(B, 6.2, 2.32, 0.95, { sheer: 0.24, vPower: 2.2 });
  deckPatch(B, -2.88, 0.8, 1.88, H.deck);
  deckPatch(B, 1.50, 2.8, 1.18, H.topAt(1.7) + 0.06, 'bow');
  // Low cockpit sides and two contrasting hull accent bands.
  for (const s of [-1, 1]) { B.box([-0.75, H.deck + 0.15, s * 0.98], [3.85, 0.32, 0.20], B.mat.white, 0.07); B.tube([[-2.8, 0.82, s * 0.96], [-1.3, 0.78, s * 1.11], [0.8, 0.86, s * 0.96], [2.4, 1.03, s * 0.53]], 0.035, B.mat.roof); }
  bench(B, -2.13, H.deck + 0.35, 0, 1.68, 0.57, 1);
  seat(B, -0.65, H.deck + 0.42, -0.56, 0.57);
  seat(B, -0.65, H.deck + 0.42, 0.56, 0.57);
  helm(B, 0.18, H.deck + 0.31, 0.57, 0.9);
  B.box([0.24, H.deck + 0.46, -0.59], [0.70, 0.45, 0.76], B.mat.white, 0.09);
  B.box([0.15, H.deck + 0.70, -0.58], [0.51, 0.025, 0.55], B.mat.dark, 0.035);
  // Separate port and starboard windscreens leave a central walk-through.
  for (const s of [-1, 1]) {
    const p = [[0.66, H.deck + 0.59, s * 0.21], [0.56, H.deck + 0.59, s * 1.00], [0.21, H.deck + 1.05, s * 0.96], [0.30, H.deck + 1.05, s * 0.21]];
    B.panel(p, B.mat.glass); B.tube([...p, p[0]], 0.026, B.mat.steel);
    const side = [[0.56, H.deck + 0.59, s * 1.00], [-0.19, H.deck + 0.55, s * 1.01], [0.21, H.deck + 1.05, s * 0.96]];
    B.panel(side, B.mat.glass); B.tube([...side, side[0]], 0.023);
    bench(B, 1.43, H.deck + 0.27, s * 0.57, 1.30, 0.43, -s, 'x');
  }
  B.box([2.15, H.deck + 0.18, 0], [0.55, 0.18, 0.72], B.mat.cushion, 0.08);
  rails(B, H, 0.96, 2.84, 0.32, 0.7);
  fittings(B, H, { portholes: false, navX: 0.45 });
  outboard(B, -3.36, H.deck - 0.1, 0, 0.92);
  for (const s of [-1, 1]) { B.box([-3.18, H.deck - 0.11, s * 0.72], [0.58, 0.12, 0.52], B.mat.white, 0.06); deckPatch(B, -3.42, -2.94, 0.42, H.deck - 0.035); }
  // Two cup holders and speakers in the cockpit mouldings.
  for (const s of [-1, 1]) { B.add(new B.T.TorusGeometry(0.055, 0.012, 7, 18), B.mat.steel, [-1.55, H.deck + 0.33, s * 0.94], [Math.PI / 2, 0, 0]); B.add(new B.T.CircleGeometry(0.085, 20), B.mat.dark, [-1.2, H.deck + 0.15, s * 0.88], [0, s < 0 ? Math.PI : 0, 0]); }
}

function fishingBoat(B) {
  const H = hull(B, 8.1, 2.85, 1.28, { sheer: 0.32, vPower: 2.9 });
  deckPatch(B, -3.80, 3.55, 2.35, H.deck);
  for (const s of [-1, 1]) B.box([-1.05, H.deck + 0.22, s * 1.25], [5.4, 0.43, 0.19], B.mat.white, 0.055);
  cabin(B, -0.65, 1.77, H.deck + 0.05, H.deck + 1.97, 1.90, { windows: 3, rake: 0.43 });
  seat(B, 0.50, H.deck + 0.55, 0.43, 0.55); helm(B, 1.13, H.deck + 0.48, 0.43, 0.95);
  bench(B, -0.10, H.deck + 0.37, -0.47, 1.35, 0.51, -1, 'x');
  bench(B, -3.25, H.deck + 0.35, 0, 1.85, 0.50);
  B.box([-2.20, H.deck + 0.22, -0.79], [0.89, 0.44, 0.59], B.mat.white, 0.06);
  B.box([-2.20, H.deck + 0.46, -0.79], [0.87, 0.055, 0.57], B.mat.cushion, 0.045);
  B.box([-2.27, H.deck + 0.024, 0.20], [1.10, 0.025, 0.72], B.mat.white, 0.035);
  for (const s of [-1, 1]) { outboard(B, -4.30, H.deck + 0.02, s * 0.55, 1.10); B.cylinder([-2.9, H.deck + 0.43, s * 1.20], [-2.76, H.deck + 0.79, s * 1.30], 0.048, B.mat.steel); B.cylinder([-1.57, H.deck + 0.43, s * 1.20], [-1.43, H.deck + 0.79, s * 1.30], 0.048); }
  rails(B, H, -0.77, 3.82, 0.68, 0.82);
  fittings(B, H, { ports: 2, navX: 1.1 });
  radar(B, 0.15, H.deck + 2.12, 0.85);
  for (const s of [-1, 1]) { B.cylinder([-0.12, H.deck + 2.12, s * 0.76], [-0.39, H.deck + 3.55, s * 0.86], 0.018, B.mat.white); B.tube([[-0.54, H.deck + 1.08, s * 0.98], [0.23, H.deck + 1.15, s * 0.98], [0.88, H.deck + 1.17, s * 0.98]], 0.022); }
  B.sphere([0.65, H.deck + 2.21, 0], [0.22, 0.08, 0.22], B.mat.white);
  // Roof rod rack and two ready fishing rods in the aft holders.
  for (let k = 0; k < 4; k++) B.cylinder([-0.63, H.deck + 2.14, -0.6 + k * 0.4], [-0.87, H.deck + 2.48, -0.6 + k * 0.4], 0.038);
  for (const s of [-1, 1]) { B.tube([[-2.85, H.deck + 0.57, s * 1.23], [-3.04, H.deck + 1.37, s * 1.39], [-3.18, H.deck + 2.29, s * 1.53]], 0.012, B.mat.dark); B.sphere([-2.91, H.deck + 0.79, s * 1.27], [0.065, 0.08, 0.065], B.mat.steel); }
  B.box([-0.10, H.deck + 0.66, -0.99], [0.37, 0.40, 0.025], B.mat.white, 0.015);
}

function cabinBoat(B) {
  const H = hull(B, 9.6, 3.08, 1.40, { sheer: 0.26, vPower: 2.35 });
  deckPatch(B, -4.51, 3.95, 2.51, H.deck);
  // Raised foredeck and streamlined forward trunk cabin.
  B.prism([[0.8, -1.03], [3.9, -0.42], [4.20, 0], [3.9, 0.42], [0.8, 1.03]], H.deck, 0.31, B.mat.white);
  cabin(B, -1.79, 1.52, H.deck + 0.09, H.deck + 1.78, 2.38, { rake: 0.70, windows: 3, darkGlass: false });
  B.box([0.08, H.deck + 0.075, 0], [2.95, 0.08, 2.18], B.mat.teak);
  seat(B, 0.33, H.deck + 0.56, 0.68, 0.62); helm(B, 1.02, H.deck + 0.50, 0.67, 1.04);
  bench(B, -0.68, H.deck + 0.41, -0.68, 1.75, 0.58, -1, 'x');
  B.cylinder([-0.66, H.deck + 0.06, -0.03], [-0.66, H.deck + 0.67, -0.03], 0.055);
  B.box([-0.66, H.deck + 0.69, -0.03], [0.82, 0.055, 0.56], B.mat.teak, 0.04);
  bench(B, -3.75, H.deck + 0.35, 0, 2.10, 0.64);
  bench(B, -2.86, H.deck + 0.35, -0.98, 1.40, 0.55, -1, 'x');
  for (const s of [-1, 1]) B.box([-3.13, H.deck + 0.27, s * 1.33], [2.51, 0.48, 0.20], B.mat.white, 0.07);
  B.box([2.38, H.deck + 0.38, 0], [1.69, 0.13, 1.46], B.mat.cushion, 0.085);
  for (const z of [-0.39, 0.10, 0.52]) B.tube([[1.60, H.deck + 0.452, z], [3.12, H.deck + 0.452, z]], 0.007, B.mat.seatEdge);
  B.box([1.31, H.deck + 0.36, 0], [0.46, 0.045, 0.58], B.mat.blackGlass, 0.05);
  swimPlatform(B, H, 0.82);
  for (const s of [-1, 1]) { B.cylinder([-4.21, 0.48, s * 0.74], [-4.86, 0.19, s * 0.74], 0.055, B.mat.bronze); propeller(B, -4.90, 0.18, s * 0.74, 0.18); }
  rails(B, H, -1.83, 4.43, 0.66, 0.9);
  fittings(B, H, { ports: 4, navX: 1.31 });
  radar(B, -0.65, H.deck + 1.94, 1.03);
  for (const s of [-1, 1]) B.tube([[-1.43, H.deck + 1.99, s * 0.95], [-0.35, H.deck + 1.99, s * 0.95], [0.29, H.deck + 1.99, s * 0.88]], 0.028);
  B.box([-1.2, H.deck + 1.93, 0], [0.48, 0.05, 0.60], B.mat.blackGlass, 0.05);
}

function propeller(B, x, y, z, radius = 0.30) {
  B.cylinder([x - 0.06, y, z], [x + 0.20, y, z], radius * 0.20, B.mat.bronze);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; B.add(new B.T.SphereGeometry(1, 12, 8), B.mat.bronze, [x, y + Math.cos(a) * radius * 0.6, z + Math.sin(a) * radius * 0.6], [a + 0.40, 0.3, 0], [0.055, radius * 0.62, radius * 0.25]); }
}

function motorYacht(B) {
  const H = hull(B, 18, 5.0, 2.42, { sheer: 0.48, vPower: 2.5 });
  deckPatch(B, -8.56, 7.76, 4.12, H.deck);
  // Broad main-deck salon and an upper flybridge, clearly distinct from the sport yacht.
  B.prism([[-5.12, -2.02], [2.82, -2.02], [3.85, -1.35], [4.18, 0], [3.85, 1.35], [2.82, 2.02], [-5.12, 2.02]], H.deck, 0.63, B.mat.white);
  cabin(B, -5.0, 3.42, H.deck + 0.39, H.deck + 2.39, 3.89, { rake: 0.74, windows: 5, darkGlass: true });
  B.box([-1.7, H.deck + 2.59, 0], [7.18, 0.18, 4.16], B.mat.white, 0.16);
  deckPatch(B, -4.78, 1.96, 3.68, H.deck + 2.68);
  // Flybridge low windscreen wraps around the helm.
  for (const s of [-1, 1]) B.panel([[2.04, H.deck + 2.84, s * 1.69], [1.56, H.deck + 3.36, s * 1.59], [-0.45, H.deck + 3.36, s * 1.65], [-0.76, H.deck + 2.84, s * 1.78]], B.mat.glass, 0.027);
  B.panel([[2.04, H.deck + 2.84, -1.69], [2.04, H.deck + 2.84, 1.69], [1.56, H.deck + 3.36, 1.59], [1.56, H.deck + 3.36, -1.59]], B.mat.glass, 0.027);
  helm(B, 1.04, H.deck + 2.89, 0.70, 1.12); seat(B, 0.08, H.deck + 3.13, 0.69, 0.67); seat(B, 0.08, H.deck + 3.13, -0.28, 0.67);
  bench(B, -3.77, H.deck + 3.02, 0, 2.82, 0.72);
  bench(B, -2.55, H.deck + 3.02, -1.31, 1.77, 0.68, -1, 'x');
  B.cylinder([-2.65, H.deck + 2.76, 0.12], [-2.65, H.deck + 3.37, 0.12], 0.075); B.box([-2.65, H.deck + 3.40, 0.12], [1.20, 0.07, 0.86], B.mat.teak, 0.10);
  // Radar arch supports a small canvas hardtop, open on every side.
  for (const s of [-1, 1]) { B.tube([[-3.15, H.deck + 2.73, s * 1.73], [-2.66, H.deck + 4.62, s * 1.60], [-1.14, H.deck + 4.76, s * 1.60], [-0.30, H.deck + 2.75, s * 1.73]], 0.075, B.mat.white); }
  B.box([-1.86, H.deck + 4.76, 0], [3.12, 0.13, 3.65], B.mat.white, 0.09);
  radar(B, -2.02, H.deck + 4.84, 1.58);
  B.sphere([-2.73, H.deck + 5.14, -0.96], [0.26, 0.33, 0.26], B.mat.white);
  B.sphere([-2.73, H.deck + 5.14, 0.96], [0.26, 0.33, 0.26], B.mat.white);
  // Open aft cockpit and its teak table.
  bench(B, -7.53, H.deck + 0.40, 0, 3.55, 0.80);
  bench(B, -6.59, H.deck + 0.40, -1.74, 1.70, 0.65, -1, 'x');
  B.cylinder([-6.58, H.deck + 0.08, 0], [-6.58, H.deck + 0.82, 0], 0.09); B.box([-6.58, H.deck + 0.84, 0], [1.24, 0.09, 1.58], B.mat.teak, 0.09);
  for (const s of [-1, 1]) B.box([-6.73, H.deck + 0.34, s * 2.17], [3.28, 0.63, 0.22], B.mat.white, 0.08);
  // Six visible stairs lead from cockpit to flybridge.
  for (let k = 0; k < 7; k++) { const x = -5.55 + k * 0.29, y = H.deck + 0.16 + k * 0.34; B.box([x, y, 1.28], [0.35, 0.12, 0.70], B.mat.white, 0.025); B.box([x, y + 0.075, 1.28], [0.30, 0.025, 0.62], B.mat.teak); }
  B.tube([[-5.72, H.deck + 1.08, 1.68], [-4.0, H.deck + 3.09, 1.68]], 0.035);
  // Bow sun pads and deck hatch.
  B.box([5.46, H.deck + 0.22, 0], [2.27, 0.18, 2.32], B.mat.cushion, 0.09);
  for (const z of [-0.58, 0.12, 0.72]) B.tube([[4.43, H.deck + 0.317, z], [6.50, H.deck + 0.317, z]], 0.009, B.mat.seatEdge);
  B.box([7.10, H.topAt(7.10) + 0.08, 0], [0.74, 0.05, 0.74], B.mat.blackGlass, 0.06);
  rails(B, H, -8.43, 8.54, 0.89, 1.32, 0.13);
  fittings(B, H, { ports: 6, navX: 2.92 }); swimPlatform(B, H, 1.43, 0.78);
  for (const s of [-1, 1]) { B.cylinder([-6.9, 0.80, s * 1.18], [-8.5, 0.26, s * 1.18], 0.075, B.mat.bronze); propeller(B, -8.48, 0.28, s * 1.18, 0.34); B.box([-8.65, 0.31, s * 1.18], [0.39, 0.55, 0.06], B.mat.steel, 0.025); }
  // Long dark hull windows identify the accommodations deck.
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) B.box([-4.9 + k * 1.38, H.deck - 0.68, s * (H.widthAt(-4.9 + k * 1.38) * 0.985)], [0.94, 0.31, 0.025], B.mat.blackGlass, 0.08);
}

function sailSurface(B, a, b, c, camber, color = B.mat.sail) {
  // Barycentric tessellation creates an actual curved cloth surface, not a flat triangle.
  const T = B.T, N = 30, vertices = [], faces = [], map = [];
  for (let i = 0; i <= N; i++) {
    map[i] = [];
    for (let j = 0; j <= N - i; j++) {
      const u = i / N, v = j / N, w = 1 - u - v; map[i][j] = vertices.length / 3;
      vertices.push(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v + camber * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * Math.sin(Math.PI * w) * 3.8);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) { faces.push(map[i][j], map[i + 1][j], map[i][j + 1]); if (j < N - i - 1) faces.push(map[i + 1][j], map[i + 1][j + 1], map[i][j + 1]); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); g.setIndex(faces); g.computeVertexNormals(); B.add(g, color);
  B.tube([a, b], 0.015, B.mat.seam); B.tube([b, c], 0.015, B.mat.seam); B.tube([c, a], 0.015, B.mat.seam);
  // Horizontal stitched sail panels; interpolate the same cambered surface.
  const at = (u, v) => { const w = 1 - u - v; return [a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v + camber * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * Math.sin(Math.PI * w) * 3.8 + 0.004]; };
  for (let k = 1; k < 12; k++) { const u = k / 12, pts = []; for (let j = 0; j <= 24; j++) pts.push(at(u, j / 24 * (1 - u))); B.tube(pts, 0.006, B.mat.seam, 30); }
}

function sailingYacht(B) {
  const H = hull(B, 12.2, 3.62, 1.42, { sheer: 0.26, vPower: 1.9 });
  const D = H.deck;
  deckPatch(B, -5.83, 5.46, 2.98, D);
  // A genuine deep fin keel and spade rudder beneath the hull.
  const keel = [[[-0.7, 0.18, -0.20], [1.00, 0.18, -0.20], [0.50, -1.65, -0.10], [-0.35, -1.65, -0.10]], [[-0.7, 0.18, 0.20], [1.00, 0.18, 0.20], [0.50, -1.65, 0.10], [-0.35, -1.65, 0.10]]];
  B.panel(keel[0], B.mat.paint); B.panel([...keel[1]].reverse(), B.mat.paint);
  for (let j = 0; j < 4; j++) B.panel([keel[0][j], keel[1][j], keel[1][(j + 1) % 4], keel[0][(j + 1) % 4]], B.mat.paint);
  B.sphere([0.1, -1.63, 0], [0.82, 0.17, 0.19], B.mat.paint);
  B.box([-4.69, -0.27, 0], [0.66, 1.29, 0.095], B.mat.white, 0.04);
  B.cylinder([-4.19, 0.15, 0], [-4.54, -0.20, 0], 0.035, B.mat.bronze); propeller(B, -4.55, -0.20, 0, 0.18);
  // Coachroof with slanted dark strip windows and flush hatches.
  B.prism([[-1.70, -1.12], [2.30, -0.86], [2.80, 0], [2.30, 0.86], [-1.70, 1.12]], D + 0.03, 0.57, B.mat.white);
  for (const s of [-1, 1]) B.panel([[-1.50, D + 0.20, s * 1.13], [2.06, D + 0.20, s * 0.92], [1.70, D + 0.46, s * 0.91], [-1.39, D + 0.46, s * 1.13]], B.mat.blackGlass, 0.018);
  for (const x of [-0.8, 0.95, 3.40]) { const yy = x > 3 ? D + 0.08 : D + 0.62; B.box([x, yy, 0], [0.58, 0.045, 0.64], B.mat.steel, 0.04); B.box([x, yy + 0.025, 0], [0.50, 0.024, 0.56], B.mat.blackGlass, 0.025); }
  B.box([-1.63, D + 0.37, 0], [0.055, 0.58, 0.65], B.mat.teak, 0.01);
  B.box([-1.58, D + 0.66, 0], [0.56, 0.05, 0.77], B.mat.blackGlass, 0.025);
  // Aft cockpit, two bench seats, wheel, pedestal and slatted folding table.
  for (const s of [-1, 1]) bench(B, -3.23, D + 0.29, s * 1.12, 2.43, 0.53, s, 'x');
  B.box([-4.52, D + 0.25, 0], [0.54, 0.42, 2.12], B.mat.white, 0.055);
  B.cylinder([-3.75, D + 0.05, 0], [-3.75, D + 0.82, 0], 0.065, B.mat.white);
  B.add(new B.T.TorusGeometry(0.47, 0.023, 8, 44), B.mat.steel, [-3.88, D + 0.75, 0], [0, Math.PI / 2, 0]);
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; B.cylinder([-3.88, D + 0.75, 0], [-3.88, D + 0.75 + Math.cos(a) * 0.46, Math.sin(a) * 0.46], 0.012); }
  B.box([-3.75, D + 1.01, 0], [0.22, 0.10, 0.32], B.mat.dark, 0.035);
  B.box([-2.66, D + 0.63, 0], [1.0, 0.06, 0.62], B.mat.teak, 0.03);
  B.cylinder([-2.66, D + 0.07, 0], [-2.66, D + 0.61, 0], 0.04);
  // Rig: one tapered mast, boom, two spreader levels, forestay/backstay and shrouds.
  const mx = 0.81, mastFoot = D + 0.61, mastTop = D + 16.70, boomY = D + 2.13;
  B.cylinder([mx, mastFoot, 0], [mx, mastTop, 0], 0.115, B.mat.roof, 16, 0.047);
  B.cylinder([mx, boomY, 0], [-3.74, boomY - 0.08, 0.04], 0.085, B.mat.roof, 14, 0.065);
  B.cylinder([mx - 0.08, D + 0.76, 0], [-2.52, boomY - 0.10, 0.03], 0.026);
  for (const yy of [D + 7.0, D + 11.0]) B.cylinder([mx, yy, -1.34], [mx, yy, 1.34], 0.038, B.mat.roof);
  B.cylinder([mx, mastTop, 0], [5.47, D + 0.26, 0], 0.010, B.mat.steel, 6);
  B.cylinder([mx, mastTop, 0], [-5.22, D + 0.24, 0], 0.010, B.mat.steel, 6);
  for (const s of [-1, 1]) {
    B.tube([[mx, mastTop - 0.15, 0], [mx, D + 11, s * 1.34], [mx, D + 7.0, s * 1.34], [0.45, D + 0.16, s * 1.57]], 0.009, B.mat.steel, 16);
    B.cylinder([mx, D + 11, 0], [-0.17, D + 0.16, s * 1.57], 0.008, B.mat.steel, 6);
    B.cylinder([mx, D + 7.0, 0], [1.08, D + 0.16, s * 1.56], 0.008, B.mat.steel, 6);
    B.cylinder([0.45, D + 0.12, s * 1.57], [0.45, D + 0.35, s * 1.57], 0.025);
  }
  // Full white Dacron mainsail and overlapping headsail; each has curved panels and hems.
  sailSurface(B, [mx - 0.07, boomY + 0.05, 0.04], [mx - 0.07, mastTop - 0.31, 0.01], [-3.60, boomY + 0.07, 0.15], 0.40);
  sailSurface(B, [5.31, D + 0.47, 0.04], [mx + 0.09, mastTop - 0.58, 0.04], [-0.45, D + 1.45, 0.34], 0.46);
  B.cylinder([mx, mastTop + 0.02, 0], [mx, mastTop + 0.54, 0], 0.011, B.mat.dark, 6);
  B.cylinder([mx - 0.15, mastTop + 0.10, 0], [mx + 0.34, mastTop + 0.10, 0], 0.008, B.mat.dark, 6);
  // Running rigging: mainsheet blocks, jib sheets, winches and mast-foot organisers.
  B.tube([[-3.59, boomY - 0.07, 0.04], [-3.26, D + 0.29, -0.4], [-3.52, boomY - 0.10, 0.04], [-3.1, D + 0.29, 0.4]], 0.014, B.mat.rope);
  for (const s of [-1, 1]) {
    B.tube([[-0.45, D + 1.45, 0.34], [-1.8, D + 0.18, s * 1.35], [-2.24, D + 0.48, s * 1.18]], 0.013, B.mat.rope);
    for (const xp of [-2.15, -0.31]) { B.cylinder([xp, D + 0.39, s * 1.25], [xp, D + 0.60, s * 1.25], 0.09, B.mat.dark, 14, 0.105); B.cylinder([xp, D + 0.61, s * 1.25], [xp + 0.18, D + 0.61, s * 1.25], 0.018); }
    B.tube([[mx + 0.03, mastTop - 0.25, s * 0.08], [mx + 0.03, mastFoot + 0.04, s * 0.10], [-0.70, D + 0.65, s * 0.59], [-1.60, D + 0.67, s * 0.59]], 0.009, B.mat.rope, 24);
  }
  rails(B, H, -5.68, 5.72, 0.64, 1.05, 0.11); fittings(B, H, { ports: 5, navX: 3.14 });
  B.tube([[-5.78, D + 0.02, -0.75], [-5.78, D + 0.66, -0.75], [-5.79, D + 0.66, 0.75], [-5.78, D + 0.02, 0.75]], 0.022);
  for (const s of [-1, 1]) { B.cylinder([-1.50, D + 0.69, s * 0.72], [1.43, D + 0.69, s * 0.68], 0.024); for (const xp of [-1.39, 0.0, 1.32]) B.cylinder([xp, D + 0.59, s * 0.70], [xp, D + 0.70, s * 0.70], 0.019); }
}

function sportYacht(B) {
  const H = hull(B, 14.2, 4.05, 1.90, { sheer: 0.45, vPower: 2.35 });
  const D = H.deck;
  deckPatch(B, -6.76, 6.13, 3.36, D);
  // Low elongated deckhouse: sharply raked windshield and roof stretching over the cockpit.
  B.prism([[-3.8, -1.66], [3.13, -1.60], [4.67, -0.86], [5.03, 0], [4.67, 0.86], [3.13, 1.60], [-3.8, 1.66]], D, 0.40, B.mat.white);
  cabin(B, -3.18, 2.87, D + 0.18, D + 1.92, 3.08, { rake: 1.16, windows: 4, darkGlass: true, slim: true });
  B.prism([[-4.03, -1.78], [1.75, -1.67], [2.02, 0], [1.75, 1.67], [-4.03, 1.78]], D + 1.91, 0.13, B.mat.white);
  B.box([-0.29, D + 2.07, 0], [2.17, 0.025, 1.72], B.mat.blackGlass, 0.15);
  // Glazed roof pillars taper down to the aft cockpit.
  for (const s of [-1, 1]) { B.tube([[-4.0, D + 1.96, s * 1.70], [-4.32, D + 1.20, s * 1.68], [-4.48, D + 0.31, s * 1.63]], 0.07, B.mat.white); B.tube([[-4.25, D + 0.79, s * 1.73], [-5.0, D + 0.75, s * 1.79]], 0.028); }
  seat(B, 0.61, D + 0.63, 0.81, 0.68); seat(B, 0.61, D + 0.63, -0.17, 0.68); helm(B, 1.45, D + 0.53, 0.77, 1.14);
  bench(B, -1.46, D + 0.44, -1.05, 2.29, 0.65, -1, 'x');
  B.cylinder([-1.58, D + 0.09, 0.18], [-1.58, D + 0.80, 0.18], 0.065); B.box([-1.58, D + 0.83, 0.18], [1.24, 0.07, 0.87], B.mat.teak, 0.09);
  bench(B, -5.10, D + 0.40, 0, 2.68, 0.72);
  bench(B, -4.27, D + 0.40, -1.29, 1.50, 0.60, -1, 'x');
  B.box([-5.78, D + 0.46, 0], [1.55, 0.17, 2.69], B.mat.cushion, 0.11);
  B.box([3.82, D + 0.50, 0], [2.07, 0.18, 2.05], B.mat.cushion, 0.09);
  for (const z of [-0.58, 0.1, 0.70]) { B.tube([[2.91, D + 0.60, z], [4.72, D + 0.60, z]], 0.008, B.mat.seatEdge); B.tube([[-6.44, D + 0.55, z], [-5.09, D + 0.55, z]], 0.008, B.mat.seatEdge); }
  B.box([5.3, H.topAt(5.3) + 0.08, 0], [0.62, 0.04, 0.66], B.mat.blackGlass, 0.06);
  swimPlatform(B, H, 1.03, 0.80);
  for (const s of [-1, 1]) { B.box([-4.82, D + 0.31, s * 1.77], [3.40, 0.58, 0.21], B.mat.white, 0.08); B.cylinder([-5.4, 0.48, s * 0.94], [-6.7, 0.16, s * 0.94], 0.058, B.mat.bronze); propeller(B, -6.72, 0.16, s * 0.94, 0.27); }
  rails(B, H, -3.20, 6.67, 0.63, 1.08, 0.12); fittings(B, H, { ports: 5, navX: 2.7 });
  radar(B, -1.89, D + 2.08, 1.11);
  for (const s of [-1, 1]) for (const xp of [-3.6, -1.9, -0.2, 1.5]) B.box([xp, D - 0.57, s * H.widthAt(xp) * 0.99], [1.08, 0.24, 0.022], B.mat.blackGlass, 0.075);
}
