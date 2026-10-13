/**
 * The pictures of the district shop (src/pages/city/CityShop.tsx): every thing it sells, rendered from the city's own
 * models and layouts (world/landLayouts.ts, world/decor.ts, assets/catalogue.ts) on a tile of grass, in a headless
 * browser, and written to public/city/shop/v1 as small WebP files the shop loads only when it shows them. Run it
 * again when a model or a layout changes (and bump the folder's version, so browsers take the new pictures):
 *
 *   cd frontend && node scripts/shop-pictures.mjs
 *
 * It needs Playwright's Chromium: the `playwright` package, or the module named by PLAYWRIGHT
 * (e.g. PLAYWRIGHT=/usr/lib/node_modules/playwright/index.mjs). The browser draws with WebGL in software.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = fileURLToPath(new URL("../public/city/shop/v1/", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright").catch(() => {
  throw new Error("Playwright is needed: npm i -D playwright, or PLAYWRIGHT=<path to playwright/index.mjs>");
});

/** The page that draws the pictures, one after another, and leaves them on window.shopPictures. */
const PAGE = /* js */ `
import * as THREE from "three/webgpu";
import { createCatalogue, loadCatalogueModels } from "/src/city3d/assets/catalogue.ts";
import { lodFiles } from "/src/city3d/assets/modelFiles.ts";
import { createInstancePools } from "/src/city3d/render/instances.ts";
import { createPatches } from "/src/city3d/render/terrain.ts";
import { areaFrame } from "/src/city3d/world/land.ts";
import { plotLayout } from "/src/city3d/world/landLayouts.ts";
import { decorLayout, decorMap } from "/src/city3d/world/decor.ts";
import { DECOR_FAMILIES, PLOT_SIZE } from "/src/city3d/world/estateGrid.ts";

const WIDTH = 320, HEIGHT = 240, SCALE = 2, CELL = 3, TOP = .2;
/** Everything the shop sells: the buildings but the parks (they gather from squares), and every small thing. */
const ITEMS = [...Object.keys(PLOT_SIZE).filter(f => f !== "park" && f !== "bigpark"), ...DECOR_FAMILIES];
/** Small things laid in a line (they join their neighbours); the others stand apart on every second cell. */
const LINES = ["road", "path", "alley", "hedge"];

const rectBlock = (cols, rows) => ({ district: 1, block: 1, band: 1, cols, rows, skip: new Set(),
  shape: { kind: "rect", x0: -cols * CELL / 2, x1: cols * CELL / 2, z0: -rows * CELL / 2, z1: rows * CELL / 2 } });

/** The paving of roads and footpaths: flat quads of one mesh. */
function paving(quads) {
  const positions = [], colours = [], index = [], c = new THREE.Color();
  for (const q of quads) {
    const base = positions.length / 3, [a, b, d] = q.points;
    c.set(q.colour);
    for (const p of q.points) { positions.push(p.x, q.y, p.z); colours.push(c.r, c.g, c.b); }
    const up = (b.z - a.z) * (d.x - a.x) - (b.x - a.x) * (d.z - a.z) > 0;
    index.push(...(up ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .82, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** A thing on its tile of grass: its placements, the yard or paving under it, and the tile's size. */
function stage(family) {
  if (!DECOR_FAMILIES.includes(family)) {
    const [cols, rows] = PLOT_SIZE[family], block = rectBlock(cols, rows);
    const layout = plotLayout(areaFrame(block, 0, 0, cols, rows, "z1"), family, 1, 7);
    return { cols, rows, placements: layout.placements, surfaces: layout.surfaces, ground: [] };
  }
  // One row of cells, close up: a line of four, or two standing apart (two benches side by side).
  const line = LINES.includes(family), cols = line ? 4 : family === "bench" ? 2 : 3, rows = 1, block = rectBlock(cols, rows);
  const cells = line ? [0, 1, 2, 3].map(c => [c, 0]) : family === "bench" ? [[0, 0], [1, 0]] : [[0, 0], [2, 0]];
  const map = decorMap([{ number: 1, decor: { [family]: cells.map(([c, r]) => [1, c, r, 1]) } }]);
  const layout = decorLayout({ city: "support", bands: 1, blocks: [block], centres: [] }, map);
  return { cols, rows, placements: layout.placements, surfaces: [], ground: layout.ground };
}

async function main() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE; canvas.height = HEIGHT * SCALE;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: true });
  renderer.setPixelRatio(1); renderer.setSize(canvas.width, canvas.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  await renderer.init();
  const catalogue = createCatalogue(await loadCatalogueModels(lodFiles(), { kits: false }));
  const out = document.createElement("canvas"); out.width = WIDTH; out.height = HEIGHT;
  const draw = out.getContext("2d"); draw.imageSmoothingQuality = "high";
  const camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, .5, 500);
  const grass = new THREE.MeshStandardNodeMaterial({ color: "#9fcb78", roughness: .95 }), soil = new THREE.MeshStandardNodeMaterial({ color: "#8a6b4c", roughness: 1 });
  const images = {};
  for (const family of ITEMS) {
    const scene = new THREE.Scene(), { cols, rows, placements, surfaces, ground } = stage(family);
    scene.add(new THREE.HemisphereLight("#d9ebff", "#71805c", 1.15));
    const width = cols * CELL + 1.2, depth = rows * CELL + 1.2;
    const tile = new THREE.Mesh(new THREE.BoxGeometry(width, .6, depth).translate(0, TOP - .3, 0), [soil, soil, grass, soil, soil, soil]);
    tile.receiveShadow = true; scene.add(tile);
    if (surfaces.length) scene.add(createPatches(surfaces));
    if (ground.length) scene.add(paving(ground));
    const ctx = { scene, camera, world: { radius: 100 }, quality: { lodDistances: [1e4, 2e4, 3e4] }, requestShadowUpdate() {}, onFrame: () => () => {}, onCameraMove: () => () => {}, onQuality: () => () => {} };
    const pools = createInstancePools(ctx, catalogue, placements);
    // What it takes up: the tile and every model on it.
    const box = new THREE.Box3(new THREE.Vector3(-width / 2, TOP - .6, -depth / 2), new THREE.Vector3(width / 2, TOP + .3, depth / 2));
    for (const p of placements) { const m = new THREE.Matrix4(), model = catalogue.resolve(p, m); if (model) box.union(model.bounds.clone().applyMatrix4(m)); }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // From the front and a little to the right, above, the whole of it in view.
    const look = new THREE.Vector3().setFromSphericalCoords(1, 1.0, .62), fov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const reach = sphere.radius / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * camera.aspect))) * 1.02;
    camera.position.copy(sphere.center).addScaledVector(look, reach); camera.lookAt(sphere.center); camera.updateMatrixWorld(true);
    const sun = new THREE.DirectionalLight("#ffe9c8", 3.3);
    sun.position.copy(sphere.center).add(new THREE.Vector3(-52, 46, 34).normalize().multiplyScalar(sphere.radius * 3)); sun.target.position.copy(sphere.center);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
    Object.assign(sun.shadow.camera, { left: -sphere.radius * 1.3, right: sphere.radius * 1.3, top: sphere.radius * 1.3, bottom: -sphere.radius * 1.3, near: .1, far: sphere.radius * 6 });
    scene.add(sun, sun.target);
    pools.update();
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    // In the same task as the drawing, while its buffer is still there.
    draw.clearRect(0, 0, WIDTH, HEIGHT); draw.drawImage(canvas, 0, 0, WIDTH, HEIGHT);
    images[family] = out.toDataURL("image/webp", .8);
    pools.dispose();
    scene.traverse(o => { if (o.isMesh && o !== tile) { o.geometry.dispose(); [o.material].flat().forEach(m => m !== grass && m !== soil && m.dispose()); } });
    tile.geometry.dispose();
  }
  window.shopPictures = { done: true, images };
}
main().catch(error => { window.shopPictures = { done: true, error: String(error?.stack ?? error) }; });
`;

const server = await createServer({
  root: ROOT, configFile: false, logLevel: "error", server: { port: 5199, strictPort: false },
  plugins: [{
    name: "shop-pictures",
    resolveId: id => id === "virtual:shop-pictures" ? "\0virtual:shop-pictures" : null,
    load: id => id === "\0virtual:shop-pictures" ? PAGE : null,
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== "/__shop-pictures") return next();
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><body style="margin:0"><script type="module" src="/@id/__x00__virtual:shop-pictures"></script></body></html>');
      });
    },
  }],
});
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error("page:", error.message));
  await page.goto(`${server.resolvedUrls.local[0]}__shop-pictures`);
  await page.waitForFunction(() => window.shopPictures?.done, null, { timeout: 15 * 60_000, polling: 1000 });
  const { images, error } = await page.evaluate(() => window.shopPictures);
  if (error) throw new Error(error);
  mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const [family, url] of Object.entries(images)) {
    if (!url.startsWith("data:image/webp;base64,")) throw new Error(`${family}: the browser did not encode WebP`);
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    writeFileSync(`${OUT}${family}.webp`, bytes); total += bytes.length;
    console.log(`${family}.webp ${(bytes.length / 1024).toFixed(1)} KB`);
  }
  console.log(`${Object.keys(images).length} pictures, ${(total / 1024).toFixed(0)} KB in all`);
} finally {
  await browser.close();
  await server.close();
}
