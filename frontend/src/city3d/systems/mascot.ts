/**
 * The assistant on the plaza (TZ §5.6, §7.3): a pedestal with the robot
 * Пульсар, or the operator the user chose (Quaternius glTF with its skeleton) who idles, waves every 18 s
 * and wears a headset. The pedestal is static; the figure is a mover: it stays out of the static shadow map
 * and casts into the dynamic one, so `movers` lists it. Its name tag is an HTML label (labels.ts).
 */
import * as THREE from "three/webgpu";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import maleUrl from "../../pages/city/models/operator-male.glb?url";
import femaleUrl from "../../pages/city/models/operator-female.glb?url";
import { loadCharacter } from "../assets/loader";
import type { CityContext } from "../engine/context";
import type { CityMascot } from "../types";
import { disposeTree, paintGeometry } from "./districts";
import { surfaceMaterial } from "../assets/surfaceDetail";

/** A person is 2.25 units tall, comparable to the walkers, standing on a low .35-unit plinth. */
const ROOT_Y = .3, ROOT_SCALE = 1;
const FIRST_WAVE = 2500, WAVE_EVERY = 18000;

export interface Mascot {
  setMascot(mascot: CityMascot): void;
  /** Where "look at the assistant" flies the camera (distance 18, polar 1.05). */
  focusPoint: THREE.Vector3;
  /** The name tag's anchor above the head. */
  nameAnchor: THREE.Vector3;
  /** Objects for the dynamic shadow map: the figure's root, whose children change with the choice. */
  movers: THREE.Object3D[];
  dispose(): void;
}

/** One mesh from several coloured parts: a single draw call for a figure made of spheres and cylinders. */
function painted(parts: [THREE.BufferGeometry, string][], material: THREE.Material) {
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(([g, color]) => paintGeometry(g, new THREE.Color(color))))!, material);
  parts.forEach(([g]) => g.dispose());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
const paint = () => surfaceMaterial({ vertexColors: true, finish: "paint", roughness: .58, metalness: .05 });
const cylinder = (r: number, h: number, x: number, y: number, z: number, segments = 32) => new THREE.CylinderGeometry(r, r, h, segments).translate(x, y, z);
const sphere = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, r < .1 ? 8 : 18, r < .1 ? 6 : 14).scale(sx, sy, sz).translate(x, y, z);

function robot() {
  return painted([
    [sphere(.55, 0, 1.05, 0, 1.1, .92, .8), "#65c7e8"], [sphere(.42, 0, 1.08, .26, 1, .64, .35), "#243e68"],
    [sphere(.09, -.16, 1.12, .4), "#fff09a"], [sphere(.09, .16, 1.12, .4), "#fff09a"],
    [sphere(.018, -.18, 1.145, .478), "#ffffff"], [sphere(.018, .14, 1.145, .478), "#ffffff"],
    [new THREE.TorusGeometry(.11, .012, 5, 16, Math.PI).rotateZ(Math.PI).translate(0, 1.07, .407), "#fff4d6"],
    [cylinder(.04, .32, 0, 1.6, 0), "#fff5df"], [sphere(.09, 0, 1.8, 0), "#ffbd5e"], [sphere(.28, 0, .52, 0), "#65d4b0"],
    // Inset visor trim, acoustic grilles and a neck bearing; all stay inside the old assistant's silhouette.
    [new THREE.TorusGeometry(.345, .016, 6, 30).scale(1.14, .7, 1).translate(0, 1.08, .34), "#368cbb"],
    [cylinder(.285, .035, 0, .53, 0, 20), "#3f7391"],
    ...[-1, 1].flatMap(side => [
      [sphere(.065, side * .58, 1.03, .1, .38, 1.25, .8), "#f8e9bb"],
      [sphere(.026, side * .594, 1.06, .13, .35, .3, 1), "#317da4"],
      [sphere(.026, side * .594, 1.00, .13, .35, .3, 1), "#317da4"],
    ] as [THREE.BufferGeometry, string][]),
  ], paint());
}

/** A band over the head, two ear cups and a microphone boom, on the head bone. */
function headset(male: boolean) {
  const parts = [
    new THREE.TorusGeometry(.139, .014, 8, 32, Math.PI),
    ...[-1, 1].map(side => new THREE.CylinderGeometry(.046, .046, .035, 16).rotateZ(Math.PI / 2).translate(side * .137, 0, 0)),
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(.145, -.025, .02), new THREE.Vector3(.13, -.08, .1), new THREE.Vector3(.04, -.095, .16)]), 12, .008, 6, false),
  ];
  for (const side of [-1, 1]) parts.push(new THREE.TorusGeometry(.037, .007, 5, 16).rotateY(Math.PI / 2).translate(side * .145, 0, 0));
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, surfaceMaterial({ color: "#28383f", finish: "paint", roughness: .5, metalness: .12 }));
  parts.forEach(g => g.dispose());
  mesh.position.set(0, .095, male ? -.03 : .005); mesh.castShadow = true;
  return mesh;
}

/** Keep the chosen operator and skeleton, with rounded shading and bright cartoon workwear. */
function dressOperator(model: THREE.Object3D, gender: "male" | "female") {
  model.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.geometry;
    original.deleteAttribute("normal");
    mesh.geometry = mergeVertices(original, .0001); mesh.geometry.computeVertexNormals(); original.dispose();
    mesh.castShadow = mesh.receiveShadow = true;
    for (const material of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
      if (!material.isMeshStandardMaterial) continue;
      material.roughness = .78; material.metalness = 0;
      if (["Red_Dark", "Orange"].includes(material.name)) material.color.set(gender === "male" ? "#318fcf" : "#ef8465");
      if (material.name === "White") material.color.set("#fff2d5");
    }
  });
  const head = model.getObjectByName("Head");
  // A restrained larger head is shared by the skinned operator and their headset; bind weights and clips stay intact.
  if ((head as THREE.Bone | undefined)?.isBone) head!.scale.multiplyScalar(1.12);
  head?.add(headset(gender === "male"));
  mergeSkinned(model);
}

/**
 * The kit splits the operator into ten skinned meshes, one per colour, on one skeleton. Merged with vertex
 * colours they are one skinned mesh: one draw call instead of ten in each pass. Left as is if they differ.
 */
function mergeSkinned(model: THREE.Object3D) {
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const [first] = meshes;
  // Attached skinned meshes are placed by their skeleton and bind matrix alone, not by their own node.
  if (meshes.length < 2 || meshes.some(m => m.skeleton !== first.skeleton || m.bindMode !== THREE.AttachedBindMode || !m.bindMatrix.equals(first.bindMatrix) || Array.isArray(m.material))) return;
  const keep = ["position", "normal", "skinIndex", "skinWeight"];
  const geometry = mergeGeometries(meshes.map(m => {
    for (const name of Object.keys(m.geometry.attributes)) if (!keep.includes(name)) m.geometry.deleteAttribute(name);
    return paintGeometry(m.geometry, (m.material as THREE.MeshStandardMaterial).color);
  }));
  if (!geometry) return;
  const mesh = new THREE.SkinnedMesh(geometry, surfaceMaterial({ vertexColors: true, finish: "cloth", roughness: .76, metalness: 0, side: (first.material as THREE.Material).side }));
  mesh.name = "operator"; mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
  mesh.castShadow = mesh.receiveShadow = true;
  first.parent!.add(mesh); mesh.bind(first.skeleton, first.bindMatrix);
  for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
}

export function createMascot(ctx: CityContext, initial: CityMascot = { gender: null, name: "Пульсар" }): Mascot {
  const root = new THREE.Group(); root.name = "city-mascot";
  root.position.set(0, ROOT_Y, 0); root.scale.setScalar(ROOT_SCALE); ctx.scene.add(root);
  root.add(painted([[cylinder(.91, .12, 0, .04, 0, 48), "#ffc867"], [cylinder(.86, .23, 0, .18, 0, 48), "#518fc9"], [cylinder(.81, .06, 0, .325, 0, 48), "#fff4d6"]], paint()));
  // The pedestal is a static caster.
  ctx.requestShadowUpdate();
  const figure = new THREE.Group(); figure.name = "city-mascot-figure"; root.add(figure);
  const dataset = (ctx.renderer.domElement as HTMLElement).dataset;

  let mixer: THREE.AnimationMixer | null = null, idle: THREE.AnimationAction | null = null, wave: THREE.AnimationAction | null = null;
  let nextWave = 0, request = 0, gender: CityMascot["gender"] | undefined, disposed = false;
  let assetController: AbortController | null = null;

  function clear() {
    request++;
    assetController?.abort(); assetController = null;
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    mixer = idle = wave = null;
    for (const child of [...figure.children]) { figure.remove(child); disposeTree(child); }
  }
  function operator(next: "male" | "female") {
    const current = ++request;
    const controller = new AbortController(); assetController = controller;
    loadCharacter(next === "female" ? femaleUrl : maleUrl, { signal: controller.signal }).then(gltf => {
      if (disposed || current !== request) { disposeTree(gltf.scene); return; }
      const model = gltf.scene, bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
      model.scale.setScalar(2.25 / size.y);
      model.position.y = .36 - bounds.min.y * model.scale.x;
      dressOperator(model, next); figure.add(model);
      mixer = new THREE.AnimationMixer(model);
      const idleClip = gltf.animations.find(a => a.name === "Idle_Neutral"), waveClip = gltf.animations.find(a => a.name === "Wave");
      if (idleClip) { idle = mixer.clipAction(idleClip); idle.play(); }
      // The resting pose, even when the user has turned motion off.
      mixer.update(0);
      if (waveClip) { wave = mixer.clipAction(waveClip); wave.setLoop(THREE.LoopOnce, 1); wave.clampWhenFinished = false; }
      mixer.addEventListener("finished", () => { wave?.fadeOut(.4); idle?.reset().fadeIn(.4).play(); });
      nextWave = performance.now() + FIRST_WAVE;
      dataset.character = next;
    }).catch(() => {
      if (disposed || current !== request) return;
      figure.add(robot()); dataset.character = "fallback";
    });
  }
  function setMascot(next: CityMascot) {
    if (disposed || next.gender === gender) return;
    gender = next.gender; clear();
    if (gender) operator(gender);
    else { figure.add(robot()); dataset.character = "robot"; }
  }
  setMascot(initial);

  const offFrame = ctx.onFrame((dt, now) => {
    if (!mixer || ctx.reducedMotion) return;
    mixer.update(dt);
    if (wave && now >= nextWave) { idle?.fadeOut(.35); wave.reset().fadeIn(.35).play(); nextWave = now + WAVE_EVERY; }
  });

  return {
    setMascot,
    focusPoint: new THREE.Vector3(0, 1.65, 0),
    nameAnchor: new THREE.Vector3(0, 3.15, 0),
    movers: [figure],
    dispose() {
      disposed = true; offFrame(); clear();
      root.removeFromParent(); disposeTree(root);
      delete dataset.character;
    },
  };
}
