/** Detailed generic freight vehicles. Metres, Y up, positive X is the front. */
export const MODELS = Object.freeze([
  Object.freeze({ id: 'box-truck', name: 'Городской фургон', category: 'trucks', type: 'Грузовой фургон · 2 оси', description: 'Среднетоннажный фургон с отдельной кабиной, закрытым кузовом, задними распашными дверями и сдвоенными задними колёсами.', defaultColor: '#286795' }),
  Object.freeze({ id: 'tractor-trailer', name: 'Магистральный автопоезд', category: 'trucks', type: 'Седельный тягач · 6 осей', description: 'Трёхосный тягач с высокой спальной кабиной и трёхосным полуприцепом. Проработаны сцепка, опоры, пневмолинии и задние двери.', defaultColor: '#a72f39' }),
  Object.freeze({ id: 'dump-truck', name: 'Строительный самосвал', category: 'trucks', type: 'Самосвал · 3 оси', description: 'Тяжёлый самосвал с открытым стальным кузовом, усилителями, откидным задним бортом и видимым гидравлическим подъёмником.', defaultColor: '#d87626' }),
  Object.freeze({ id: 'flatbed-truck', name: 'Бортовая платформа', category: 'trucks', type: 'Открытый грузовик · 3 оси', description: 'Длинная открытая платформа с деревянным настилом, защитной передней решёткой, стойками, крепёжными кольцами и задней тележкой.', defaultColor: '#3c7269' }),
]);

export function buildModel(THREE, id) {
  const meta = MODELS.find(m => m.id === id);
  if (!meta) throw new Error(`Unknown truck model: ${id}`);
  const root = new THREE.Group();
  root.name = meta.name;
  root.userData = { id, name: meta.name, units: 'meters' };
  const mats = makeMaterials(THREE, meta.defaultColor);
  const b = batch(THREE, root);
  const spec = id === 'box-truck'
    ? { cx: 2.38, axles: [2.81, -2.46], rear: -3.68, front: 3.65, wheel: .52, cabHeight: 3.32 }
    : id === 'tractor-trailer'
      ? { cx: 6.72, axles: [7.15, 4.55, 3.35], rear: 2.38, front: 7.94, wheel: .53, cabHeight: 3.57 }
      : id === 'dump-truck'
        ? { cx: 3.05, axles: [3.48, -1.72, -2.94], rear: -3.87, front: 4.26, wheel: .56, cabHeight: 3.42 }
        : { cx: 3.75, axles: [4.18, -2.55, -3.84], rear: -4.72, front: 4.97, wheel: .53, cabHeight: 3.40 };

  chassis(THREE, b, mats, spec);
  cab(THREE, b, mats, spec, id === 'tractor-trailer');
  for (let i = 0; i < spec.axles.length; i++) {
    wheelAxle(THREE, b, mats, spec.axles[i], spec.wheel, i > 0, i === 0);
  }
  if (id === 'box-truck') cargoBox(THREE, b, mats, -3.68, 1.13, 1.23, 3.82, false);
  if (id === 'tractor-trailer') articulated(THREE, b, mats, root);
  if (id === 'dump-truck') dumpBed(THREE, b, mats, root);
  if (id === 'flatbed-truck') flatbed(THREE, b, mats);
  b.finish();
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  // A common origin and exact ground contact make assets interchangeable.
  root.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  root.updateMatrixWorld(true);
  return root;
}

function makeMaterials(T, color) {
  const standard = (name, c, metalness = 0, roughness = .5) => {
    const m = new T.MeshStandardMaterial({ color: c, metalness, roughness });
    m.name = name; return m;
  };
  const paint = new T.MeshPhysicalMaterial({ color, metalness: .48, roughness: .27, clearcoat: .85, clearcoatRoughness: .18 });
  paint.name = 'Cab paint'; paint.userData.paint = true;
  const glass = new T.MeshPhysicalMaterial({ color: '#182e38', metalness: .30, roughness: .13, clearcoat: 1, clearcoatRoughness: .08 });
  glass.name = 'Smoked cab glass'; glass.side = T.DoubleSide;
  const lamp = standard('Headlamp lens', '#e2eef0', .3, .13);
  lamp.emissive.set('#a3bbc4'); lamp.emissiveIntensity = .17;
  const red = standard('Red lens', '#a4161e', .12, .23); red.emissive.set('#67070a'); red.emissiveIntensity = .14;
  const amber = standard('Amber lens', '#e5891a', .12, .20); amber.emissive.set('#9c4905'); amber.emissiveIntensity = .14;
  return {
    paint, glass, lamp, red, amber,
    rubber: standard('Tyre rubber', '#202226', .01, .83),
    tread: standard('Tyre tread', '#292a2d', .01, .90),
    black: standard('Black chassis steel', '#25292c', .55, .53),
    plastic: standard('Graphite trim', '#30363a', .03, .70),
    seam: standard('Panel gaps', '#162024', .05, .69),
    metal: standard('Galvanised steel', '#8a959c', .76, .32),
    chrome: standard('Polished metal', '#ccd3d5', .90, .21),
    rim: standard('Wheel alloy', '#acb4b8', .75, .29),
    white: standard('Cargo aluminium', '#d2d7d8', .47, .42),
    cargoDark: standard('Cargo understructure', '#68777e', .64, .50),
    bed: standard('Dump bed steel', '#727b7b', .60, .53),
    bedInner: standard('Dump bed inner steel', '#4f5756', .67, .67),
    plate: standard('Blank licence plate', '#e6e5dc', .08, .38),
    wood: standard('Platform timber', '#8a6c47', .0, .86),
    wood2: standard('Platform timber variation', '#9b7d54', .0, .88),
  };
}

/** Merge by material: repeated fine details stay inexpensive in a browser. */
function batch(T, group) {
  const parts = new Map();
  const unitBox = new T.BoxGeometry(1, 1, 1);
  const unitCylinder = new T.CylinderGeometry(1, 1, 1, 16, 1);
  const temp = new T.Matrix4();
  const quat = new T.Quaternion();
  const normalMatrix = new T.Matrix3();
  const vec = new T.Vector3();
  const normal = new T.Vector3();
  const euler = new T.Euler();
  function add(geo, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
    euler.set(...rot); quat.setFromEuler(euler);
    temp.compose(new T.Vector3(...pos), quat, new T.Vector3(...scale));
    normalMatrix.getNormalMatrix(temp);
    let p = parts.get(material);
    if (!p) { p = { v: [], n: [], uv: [], i: [] }; parts.set(material, p); }
    const a = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    const offset = p.v.length / 3;
    for (let i = 0; i < a.count; i++) {
      vec.fromBufferAttribute(a, i).applyMatrix4(temp); p.v.push(vec.x, vec.y, vec.z);
      if (n) normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); else normal.set(0, 1, 0);
      p.n.push(normal.x, normal.y, normal.z);
      p.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (geo.index) for (const idx of geo.index.array) p.i.push(offset + idx);
    else for (let i = 0; i < a.count; i++) p.i.push(offset + i);
  }
  function box(mat, x, y, z, sx, sy, sz, rot = [0, 0, 0]) { add(unitBox, mat, [x, y, z], [sx, sy, sz], rot); }
  function cylinder(mat, x, y, z, radius, height, rot = [0, 0, 0]) { add(unitCylinder, mat, [x, y, z], [radius, height, radius], rot); }
  function rod(mat, from, to, radius = .015, segments = 10) {
    const start = new T.Vector3(...from), end = new T.Vector3(...to);
    const dir = end.clone().sub(start), center = start.clone().add(end).multiplyScalar(.5);
    const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
    const re = new T.Euler().setFromQuaternion(rotation);
    const g = new T.CylinderGeometry(radius, radius, dir.length(), segments, 1);
    add(g, mat, center.toArray(), [1, 1, 1], [re.x, re.y, re.z]); g.dispose();
  }
  function face(mat, points) {
    const vertices = [], indices = [];
    for (const point of points) vertices.push(...point);
    for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals(); add(g, mat); g.dispose();
    // Closed, thin panels and windows need a back face when viewed through an opening.
    const g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    g2.setIndex(indices.flatMap((_, i, arr) => i % 3 === 0 ? [arr[i], arr[i + 2], arr[i + 1]] : []));
    g2.computeVertexNormals(); add(g2, mat); g2.dispose();
  }
  function finish() {
    for (const [mat, p] of parts) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(p.v, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(p.n, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(p.uv, 2)); geo.setIndex(p.i);
      geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, mat); mesh.name = mat.name; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    parts.clear(); unitBox.dispose(); unitCylinder.dispose();
  }
  return { add, box, cylinder, rod, face, finish };
}

function chassis(T, b, m, s) {
  const len = s.front - s.rear - .24, cx = (s.front + s.rear) / 2 - .1;
  for (const z of [-.72, .72]) {
    b.box(m.black, cx, .86, z, len, .26, .13);
    b.box(m.black, cx, .715, z, len, .035, .23);
    b.box(m.black, cx, 1.005, z, len, .035, .23);
  }
  for (let x = s.rear + .45; x < s.front - .4; x += .86) b.box(m.black, x, .86, 0, .12, .18, 1.5);
  b.box(m.black, s.rear + .08, .69, 0, .14, .24, 2.25);
  // Air reservoirs, silvery fuel tanks, straps and battery housings.
  const tx = s.cx - 1.60;
  for (const z of [-.98, .98]) {
    b.cylinder(m.metal, tx, .79, z, .235, .95, [0, 0, Math.PI / 2]);
    for (const dx of [-.32, .32]) b.box(m.black, tx + dx, .79, z, .045, .48, .48);
    b.cylinder(m.chrome, tx + .24, 1.04, z, .065, .045);
  }
  b.cylinder(m.black, tx - .96, .84, .42, .15, .62, [Math.PI / 2, 0, 0]);
  b.cylinder(m.black, tx - 1.28, .84, -.42, .15, .62, [Math.PI / 2, 0, 0]);
  for (let x = tx - .4; x > s.rear + .7; x -= 1.1) {
    for (const z of [-1.12, 1.12]) {
      b.box(m.metal, x, .66, z, .07, .29, .055);
      b.box(m.metal, x, .54, z, .07, .055, .27);
    }
  }
  for (const z of [-1.16, 1.16]) {
    b.box(m.metal, s.cx - .76, .59, z, .67, .065, .37);
    b.box(m.metal, s.cx - .75, .83, z, .62, .065, .31);
    for (let x = s.cx - 1.02; x < s.cx - .48; x += .12) {
      b.box(m.seam, x, .628, z, .045, .007, .27);
      b.box(m.seam, x, .868, z, .045, .007, .23);
    }
  }
  rearBumper(b, m, s.rear - .02, .64);
}

function cab(T, b, m, s, sleeper) {
  const cx = s.cx, h = s.cabHeight, rise = h - 3.32;
  const shape = new T.Shape();
  const pts = [[-1.16,.89],[-.12,.89],[-.03,1.06],[.18,1.17],[.43,1.21],[.68,1.17],[.88,1.06],[.98,.89],[1.18,.89],[1.18,2.17],[.89,3.02+rise],[.65,h],[-.94,h],[-1.16,h-.20]];
  pts.forEach((p, i) => i ? shape.lineTo(...p) : shape.moveTo(...p)); shape.closePath();
  const shell = new T.ExtrudeGeometry(shape, { depth: 2.10, steps: 1, bevelEnabled: true, bevelThickness: .065, bevelSize: .045, bevelSegments: 3, curveSegments: 6 });
  shell.translate(cx, 0, -1.05); b.add(shell, m.paint); shell.dispose();
  const fx = cx + 1.18;
  // A sloping full-width windscreen with trim, central division and fine wipers.
  const windshield = [[fx+.085,2.21,-.995],[fx+.085,2.21,.995],[cx+.965,3.02+rise,.995],[cx+.965,3.02+rise,-.995]];
  b.face(m.seam, [[fx+.075,2.15,-1.04],[fx+.075,2.15,1.04],[cx+.945,3.085+rise,1.04],[cx+.945,3.085+rise,-1.04]]);
  b.face(m.glass, windshield);
  b.rod(m.plastic, [fx+.099,2.22,0], [cx+.975,3.025+rise,0], .016);
  for (const z of [-.48,.48]) {
    b.rod(m.plastic, [fx+.114,2.22,z-.30], [fx+.025,2.48,z+.13], .014);
    b.rod(m.plastic, [fx+.047,2.40,z+.06], [fx-.030,2.65,z+.27], .020);
  }
  b.box(m.plastic, fx+.084, 2.115, 0, .055, .10, 2.05);
  b.box(m.plastic, fx+.063, 1.66, 0, .045, .60, 1.86);
  for (let y = 1.42; y < 1.92; y += .105) b.box(m.cargoDark, fx+.092, y, 0, .033, .024, 1.74);
  for (const z of [-.65,-.33,0,.33,.65]) b.box(m.seam, fx+.109, 1.66, z, .015, .51, .018);
  b.box(m.paint, fx+.065, 1.27, 0, .10, .12, 2.12);
  b.box(m.plastic, fx+.09, .84, 0, .16, .26, 2.34);
  b.box(m.metal, fx+.176, .76, 0, .024, .055, 2.16);
  b.box(m.seam, fx+.18, .91, 0, .026, .16, .61);
  b.box(m.plate, fx+.2, .91, 0, .014, .115, .49);
  for (const z of [-.89, .89]) {
    b.box(m.seam, fx+.08, 1.105, z, .08, .27, .39);
    b.box(m.lamp, fx+.127, 1.12, z, .022, .18, .30);
    b.box(m.chrome, fx+.142, 1.055, z, .014, .026, .30);
    b.box(m.amber, fx+.139, 1.225, z, .02, .042, .27);
    b.box(m.lamp, fx+.188, .82, z, .02, .075, .14);
    for (const zz of [-.075,.075]) b.cylinder(m.chrome, fx+.143, 1.12, z+zz, .043, .014, [0,0,Math.PI/2]);
  }
  for (const side of [-1,1]) {
    const z = side*1.121;
    const sidepane = [[cx-.83,2.10,z],[cx+.98,2.10,z],[cx+.72,3.055+rise,z],[cx-.83,3.055+rise,z]];
    b.face(m.seam, [[cx-.89,2.045,z-.006*side],[cx+1.035,2.045,z-.006*side],[cx+.755,3.115+rise,z-.006*side],[cx-.89,3.115+rise,z-.006*side]]);
    b.face(m.glass, sidepane);
    b.rod(m.plastic,[cx+.39,2.11,z+.01*side],[cx+.39,3.05+rise,z+.01*side],.018);
    const seam = [[cx-.97,1.01,z],[cx-.97,3.11+rise,z],[cx+.76,3.11+rise,z],[cx+1.04,2.08,z],[cx+1.04,1.33,z]];
    for(let i=0;i<seam.length-1;i++) b.rod(m.seam,seam[i],seam[i+1],.009);
    b.rod(m.seam,[cx-.96,1.01,z],[cx-.18,1.01,z],.009);
    b.box(m.seam, cx-.56, 1.94, z+side*.014, .34, .092, .025);
    b.box(m.chrome, cx-.56, 1.955, z+side*.037, .235, .032, .025);
    b.box(m.amber, cx+.96, 1.45, z+side*.017, .13, .052, .024);
    b.box(m.plastic, cx-1.09, 2.68, z+side*.016, .07, .48, .025);
    // Large side mirrors plus the small convex lower mirror.
    b.rod(m.plastic,[cx+.79,2.73,z],[cx+1.08,2.70,side*1.46],.024);
    b.rod(m.plastic,[cx+.92,2.20,z],[cx+1.10,2.19,side*1.46],.020);
    b.box(m.plastic,cx+1.10,2.48,side*1.49,.18,.55,.17,[0,side*.12,0]);
    b.box(m.chrome,cx+1.005,2.50,side*1.49,.013,.45,.13,[0,side*.12,0]);
    b.box(m.plastic,cx+1.13,2.08,side*1.49,.16,.18,.16);
    b.box(m.chrome,cx+1.044,2.08,side*1.49,.012,.12,.12);
    // Front wheel opening and a protective lower edge.
    arch(T,b,m.plastic,cx+.43,s.wheel,side*1.09,s.wheel+.095,.074,.19);
    b.box(m.plastic,cx-.56,1.01,side*1.106,.97,.10,.06);
    b.box(m.seam,cx-1.17,1.44,side*.92,.035,.82,.18);
  }
  b.box(m.plastic,cx-.01,h+.025,0,1.68,.065,1.91);
  for(const z of [-.73,0,.73]) b.box(m.amber,cx+.63,h+.064,z,.095,.045,.11);
  b.cylinder(m.black,cx-.72,h+.19,-.83,.011,.36,[0,0,.13]);
  b.box(m.plastic,cx-.70,h+.05,-.83,.12,.07,.12);
  if (sleeper) {
    b.face(m.paint,[[cx-.97,h+.05,-1.05],[cx-.97,4.00,-1.01],[cx+.40,h+.05,-1.05]]);
    b.face(m.paint,[[cx-.97,h+.05,1.05],[cx+.40,h+.05,1.05],[cx-.97,4.00,1.01]]);
    b.face(m.paint,[[cx-.97,4.00,-1.01],[cx-.97,4.00,1.01],[cx+.40,h+.05,1.05],[cx+.40,h+.05,-1.05]]);
    b.box(m.paint,cx-1.16,2.05,0,.14,2.18,2.04);
    b.box(m.plastic,cx-1.245,2.77,0,.025,.14,1.23);
    for (const side of [-1,1]) {
      b.box(m.glass,cx-.89,2.76,side*1.16,.40,.41,.018);
      b.box(m.plastic,cx-.89,2.50,side*1.173,.44,.034,.019);
      b.rod(m.chrome,[cx-1.29,1.18,side*.82],[cx-1.29,3.17,side*.82],.035);
    }
  }
}

function arch(T, b, material, x, y, z, radius, thickness, width) {
  const shape = new T.Shape(), inner = radius-thickness;
  shape.absarc(0,0,radius,0,Math.PI,false); shape.lineTo(-inner,0); shape.absarc(0,0,inner,Math.PI,0,true); shape.closePath();
  const geo = new T.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,steps:1,curveSegments:20});
  geo.translate(x,y,z-width/2); b.add(geo,material); geo.dispose();
}

function wheelAxle(T, b, m, x, r, dual, steer = false) {
  const y=r;
  b.cylinder(m.black,x,y,0,.085,2.24,[Math.PI/2,0,0]);
  b.add(new T.SphereGeometry(.18,12,8),m.black,[x,y,0],[1.5,1,1]);
  for(const side of [-1,1]) {
    b.box(m.black,x-.02,y+.14,side*.67,.62,.12,.13);
    for(let layer=0;layer<4;layer++) b.box(m.black,x,y+.18+layer*.026,side*.67,.82-layer*.10,.019,.105);
    b.rod(m.metal,[x-.27,y+.05,side*.73],[x+.19,1.05,side*.73],.044);
    const positions=dual?[side*.91,side*1.175]:[side*1.06];
    for(const z of positions) tyre(T,b,m,x,y,z,r,dual?.235:.27,side,steer);
    if(dual) {
      arch(T,b,m.plastic,x,y,side*1.075,r+.075,.052,.55);
      b.box(m.plastic,x-r-.10,.39,side*1.11,.045,.55,.52);
      b.box(m.white,x-r-.126,.25,side*1.11,.011,.045,.40);
    }
  }
}

function tyre(T,b,m,x,y,z,r,width,side,steer) {
  const profile = [[.55,-.47],[.75,-.51],[.88,-.47],[.98,-.32],[1,-.10],[1,.10],[.98,.32],[.88,.47],[.75,.51],[.55,.47]];
  const pts=profile.map(([a,c])=>new T.Vector2(a*r,c*width));
  const geo=new T.LatheGeometry(pts,32); // Lathe axis Y; rotate to the wheel's Z axle.
  b.add(geo,m.rubber,[x,y,z],[1,1,1],[Math.PI/2,0,0]); geo.dispose();
  b.cylinder(m.black,x,y,z,r*.61,width*.91,[Math.PI/2,0,0]);
  b.cylinder(m.rim,x,y,z,r*.59,width*.95,[Math.PI/2,0,0]);
  const outside=z+side*width*.48;
  b.cylinder(m.chrome,x,y,outside,r*.545,.025,[Math.PI/2,0,0]);
  b.cylinder(m.cargoDark,x,y,outside+side*.016,r*.435,.028,[Math.PI/2,0,0]);
  for(let k=0;k<10;k++) {
    const a=k*Math.PI*2/10;
    b.cylinder(m.seam,x+Math.sin(a)*r*.35,y+Math.cos(a)*r*.35,outside+side*.034,r*.074,.018,[Math.PI/2,0,0]);
    b.cylinder(m.chrome,x+Math.sin(a)*r*.22,y+Math.cos(a)*r*.22,outside+side*.043,r*.029,.038,[Math.PI/2,0,0]);
  }
  b.cylinder(m.rim,x,y,outside+side*.044,r*.185,.09,[Math.PI/2,0,0]);
  b.cylinder(m.black,x,y,outside+side*.095,r*.114,.035,[Math.PI/2,0,0]);
  for(let k=0;k<30;k++) {
    const a=k*Math.PI*2/30;
    for(const strip of [-1,1]) b.box(m.tread,x+Math.sin(a)*r*.993,y+Math.cos(a)*r*.993,z+strip*width*.21,r*.117,.012,width*.28,[0,0,-a]);
  }
  // Sidewall bead and a distinct narrow shoulder band.
  const ring=new T.TorusGeometry(r*.75,r*.012,5,32);
  b.add(ring,m.tread,[x,y,outside+side*.006]); ring.dispose();
}

function cargoBox(T,b,m,rear,front,bottom,top,trailer) {
  const cx=(rear+front)/2,len=front-rear,w=2.46;
  b.box(m.white,cx,(bottom+top)/2,0,len,top-bottom,w);
  b.box(m.metal,cx,top+.022,0,len+.035,.045,w+.025);
  b.box(m.cargoDark,cx,bottom+.015,0,len+.04,.12,w+.04);
  for(const side of [-1,1]) {
    const z=side*(w/2+.014);
    for(let x=rear+.22;x<front-.10;x+=.30) b.box(m.metal,x,(bottom+top)/2,z,.018,top-bottom-.11,.012);
    b.box(m.chrome,cx,top-.028,z,len,.055,.025);
    b.box(m.chrome,cx,bottom+.13,z,len,.055,.025);
    for(const x of [rear+.04,front-.04]) b.box(m.chrome,x,(bottom+top)/2,z,.06,top-bottom,.055);
    for(let x=rear+.32;x<front-.1;x+=1.22) {
      b.box(m.amber,x,bottom+.21,z+side*.02,.095,.055,.025);
      if(trailer) b.box(m.plate,x,bottom+.115,z+side*.023,.74,.042,.016);
    }
    b.box(m.red,rear+.16,bottom+.21,z+side*.02,.08,.058,.024);
  }
  // Separate rear door leaves, perimeter seals, hinges and long lock rods.
  b.box(m.seam,rear-.025,(bottom+top)/2,0,.045,top-bottom-.13,w-.10);
  for(const side of [-1,1]) {
    const z=side*.602;
    b.box(m.white,rear-.055,(bottom+top)/2,z,.035,top-bottom-.21,1.168);
    for(const y of [bottom+.36,bottom+.98,top-.40]) {
      b.box(m.metal,rear-.086,y,side*1.156,.048,.105,.18);
      b.cylinder(m.chrome,rear-.115,y,side*1.18,.035,.18);
      b.box(m.metal,rear-.09,y,side*.94,.022,.045,.29);
    }
    b.rod(m.chrome,[rear-.117,bottom+.14,side*.42],[rear-.117,top-.13,side*.42],.024);
    for(const y of [bottom+.25,top-.24]) b.box(m.cargoDark,rear-.14,y,side*.42,.04,.10,.105);
    b.rod(m.chrome,[rear-.148,bottom+.77,side*.42],[rear-.148,bottom+.77,side*.76],.020);
    b.box(m.seam,rear-.14,bottom+.77,side*.76,.025,.10,.10);
    b.box(m.red,rear-.09,bottom+.14,side*1.02,.022,.09,.10);
  }
  if(trailer) {
    for(const side of [-1,1]) b.box(m.metal,cx,bottom-.20,side*.82,len,.24,.12);
    for(let x=rear+.5;x<front-.3;x+=.72) b.box(m.black,x,bottom-.24,0,.10,.14,2.25);
  }
}

function rearBumper(b,m,x,y) {
  b.box(m.black,x,y,0,.13,.22,2.29);
  b.box(m.metal,x-.08,y-.14,0,.08,.12,2.42);
  for(const side of [-1,1]) {
    b.box(m.seam,x-.083,y+.01,side*.88,.04,.19,.44);
    b.box(m.red,x-.108,y+.015,side*.98,.018,.115,.17);
    b.box(m.amber,x-.109,y+.015,side*.81,.018,.115,.10);
    b.box(m.lamp,x-.110,y+.015,side*.70,.018,.115,.08);
    b.box(m.plate,x-.122,y-.13,side*.84,.014,.065,.48);
  }
  b.box(m.plate,x-.105,y+.018,0,.014,.13,.51);
  b.box(m.black,x+.13,y+.17,0,.27,.19,.36);
  b.cylinder(m.metal,x+.12,y+.30,0,.046,.10);
}

function articulated(T,b,m,root) {
  cargoBox(T,b,m,-7.85,4.81,1.57,4.12,true);
  for(const x of [-4.51,-5.70,-6.89]) wheelAxle(T,b,m,x,.50,true);
  rearBumper(b,m,-7.94,.70);
  // The exposed fifth-wheel plate and the kingpin sit in the visible articulation gap.
  b.box(m.black,4.07,1.10,0,1.30,.13,1.52);
  b.cylinder(m.metal,4.02,1.225,0,.60,.11);
  b.box(m.seam,4.52,1.29,0,.60,.025,.115);
  b.cylinder(m.black,4.02,1.41,0,.085,.33);
  b.rod(m.chrome,[4.0,1.19,.62],[4.30,1.19,.88],.028);
  // Retracted landing legs and their pads, diagonal braces, wind handle.
  for(const side of [-1,1]) {
    b.box(m.black,1.88,1.03,side*.85,.17,.89,.17);
    b.box(m.metal,1.88,.80,side*.85,.12,.42,.12);
    b.box(m.black,1.88,.565,side*.85,.38,.065,.35);
    b.rod(m.black,[1.88,1.34,side*.84],[.83,1.34,side*.84],.028);
    b.rod(m.chrome,[1.86,1.19,side*.98],[1.62,1.19,side*1.08],.020);
    b.rod(m.chrome,[1.62,1.19,side*1.08],[1.62,1.01,side*1.08],.020);
    for(const y of [.79,1.06]) b.box(m.metal,-.55,y,side*1.18,4.0,.055,.065);
    for(const x of [-2.45,-.60,1.24]) b.box(m.metal,x,.95,side*1.17,.055,.44,.065);
  }
  // Three coiled air/electrical lines use real tubular geometry.
  for(let j=0;j<3;j++) {
    const points=[];
    for(let i=0;i<=72;i++) {
      const t=i/72, a=t*Math.PI*20;
      points.push(new T.Vector3(5.49-t*.69,1.95-Math.sin(t*Math.PI)*.23+Math.sin(a)*.045,-.38+j*.27+Math.cos(a)*.045));
    }
    const g=new T.TubeGeometry(new T.CatmullRomCurve3(points),108,.014,5,false);
    b.add(g,j===0?m.red:j===1?m.amber:m.black);g.dispose();
  }
}

function dumpBed(T,b,m,root) {
  const group=new T.Group();group.name='Raised steel dump body';root.add(group);
  group.position.set(-3.89,1.40,0);group.rotation.z=.145;
  const d=batch(T,group),len=5.56;
  // Open, tapered hopper: inner faces remain visible all the way to the floor.
  d.box(m.bedInner,len/2,.025,0,len,.10,2.04);
  for(const side of [-1,1]) {
    d.face(m.bed,[[0,0,side*1.02],[len,0,side*1.02],[len,1.27,side*1.27],[0,1.27,side*1.27]]);
    d.face(m.bedInner,[[.05,.07,side*1.015],[.05,1.235,side*1.24],[len-.06,1.235,side*1.24],[len-.06,.07,side*1.015]]);
    d.box(m.chrome,len/2,1.285,side*1.265,len+.12,.09,.10);
    d.box(m.bed,len/2,.01,side*1.04,len,.15,.12);
    for(let x=.22;x<len;x+=.88) {
      d.rod(m.cargoDark,[x,.03,side*1.075],[x,1.22,side*1.309],.045);
      d.box(m.metal,x,.80,side*1.255,.075,.095,.055);
    }
    for(const x of [.18,len-.18]) d.cylinder(m.chrome,x,1.22,side*1.31,.052,.17,[0,0,Math.PI/2]);
  }
  // Hinged rear gate, end posts and latch gear.
  d.face(m.bed,[[-.045,0,-1.02],[-.045,0,1.02],[-.045,1.27,1.27],[-.045,1.27,-1.27]]);
  d.face(m.bedInner,[[.013,.08,-.99],[.013,1.22,-1.23],[.013,1.22,1.23],[.013,.08,.99]]);
  for(const z of [-.99,0,.99]) d.box(m.cargoDark,-.092,.62,z,.09,1.22,.10);
  d.box(m.chrome,-.075,1.28,0,.11,.09,2.64);
  for(const side of [-1,1]) {
    d.cylinder(m.metal,-.11,1.20,side*1.18,.055,.24,[Math.PI/2,0,0]);
    d.box(m.black,.13,.10,side*1.13,.20,.12,.10);
    d.rod(m.chrome,[.08,.12,side*1.18],[.37,.12,side*1.18],.025);
  }
  // The tall front bulkhead and canopy protect the cab from loose aggregate.
  d.face(m.bed,[[len,0,-1.02],[len,1.58,-1.27],[len,1.58,1.27],[len,0,1.02]]);
  d.box(m.bed,len+.27,1.61,0,.66,.12,2.55);
  for(const side of [-1,1]) d.box(m.cargoDark,len+.27,1.68,side*1.23,.66,.07,.08);
  for(const z of [-.70,.70]) d.box(m.black,len/2,-.12,z,len,.18,.13);
  for(let x=.2;x<len;x+=.75) d.box(m.cargoDark,x,-.13,0,.08,.14,2.16);
  d.finish();
  // A clearly visible extended telescopic hydraulic ram and pivot bearings.
  const bottom=[.10,1.02,0],top=[.83,2.11,0];
  b.rod(m.black,bottom,[.55,1.70,0],.155,16);
  b.rod(m.chrome,[.41,1.49,0],top,.100,16);
  b.cylinder(m.metal,.10,1.02,0,.115,.50,[Math.PI/2,0,0]);
  b.cylinder(m.metal,.83,2.11,0,.105,.39,[Math.PI/2,0,0]);
  b.rod(m.black,[.15,1.00,-.17],[.43,1.62,-.17],.020);
  b.box(m.black,-3.85,1.27,0,.28,.19,1.68);
  for(const side of [-1,1]) {
    b.cylinder(m.chrome,-3.88,1.40,side*.86,.13,.24,[Math.PI/2,0,0]);
    // Protective side rail and a small hydraulic reservoir.
    b.box(m.metal,-.12,.68,side*1.15,1.55,.07,.07);
    b.box(m.metal,-.12,.91,side*1.15,1.55,.07,.07);
  }
  b.box(m.black,.48,.90,-1.03,.65,.42,.34);
  b.cylinder(m.chrome,.59,1.13,-1.03,.055,.06);
}

function flatbed(T,b,m) {
  const rear=-4.76,front=2.46,cx=(rear+front)/2,len=front-rear;
  b.box(m.black,cx,1.16,0,len,.22,2.36);
  for(let z=-1.08,i=0;z<1.10;z+=.18,i++) {
    b.box(i%3===0?m.wood2:m.wood,cx,1.31,z,len-.08,.105,.169);
    for(const x of [rear+.25,-2.65,-.50,1.6,front-.25]) b.cylinder(m.metal,x,1.369,z,.015,.009);
  }
  for(const side of [-1,1]) {
    const z=side*1.235;
    b.box(m.metal,cx,1.27,z,len+.08,.21,.10);
    b.box(m.chrome,cx,1.41,z,len+.08,.045,.12);
    for(let x=rear+.18;x<front;x+=.86) {
      b.box(m.metal,x,1.65,z,.065,.47,.065);
      b.box(m.black,x,1.30,z+side*.058,.14,.09,.04);
      b.box(m.metal,x,1.84,z,.085,.035,.075);
      // Tiedown D-rings below the side sill.
      const ring=new T.TorusGeometry(.061,.012,6,12,Math.PI);
      b.add(ring,m.chrome,[x,1.13,z+side*.06],[1,1,1],[0,0,Math.PI]);ring.dispose();
      b.box(m.amber,x,1.28,z+side*.07,.08,.048,.014);
    }
    b.box(m.chrome,cx,1.86,z,len+.08,.045,.05);
    for(const y of [.64,.86]) b.box(m.metal,.15,y,side*1.14,2.67,.055,.055);
    for(const x of [-1.16,.12,1.47]) b.box(m.metal,x,.75,side*1.14,.055,.31,.06);
  }
  // Tall, open protective headboard: mesh openings are modelled, not a decal.
  for(const z of [-1.20,1.20]) b.box(m.metal,front,2.29,z,.105,1.92,.09);
  b.box(m.metal,front,3.26,0,.105,.09,2.49);
  b.box(m.metal,front,1.49,0,.105,.09,2.49);
  for(let z=-.96;z<1.1;z+=.24) b.box(m.cargoDark,front,2.37,z,.045,1.70,.035);
  for(let y=1.68;y<3.18;y+=.25) b.box(m.cargoDark,front,y,0,.047,.028,2.34);
  // Tail platform, tow ring and under-slung spare tyre.
  b.box(m.metal,rear-.04,1.28,0,.10,.23,2.54);
  b.box(m.chrome,rear-.10,1.40,0,.035,.04,2.48);
  b.cylinder(m.black,-.58,.69,0,.47,.25);
  b.cylinder(m.rim,-.58,.548,0,.275,.025);
  for(const side of [-1,1]) {
    b.rod(m.black,[-.92,.91,side*.40],[-.92,.53,side*.40],.018);
    b.rod(m.metal,[rear-.12,.94,side*.95],[rear-.12,.71,side*.95],.028);
  }
}
