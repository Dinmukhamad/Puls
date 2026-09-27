import { AnimationMixer, Box3, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CityMascot } from "../../pages/city/cityScene";
import maleUrl from "../../pages/city/models/operator-male.glb?url";
import femaleUrl from "../../pages/city/models/operator-female.glb?url";
import { disposeTree } from "../engine/resources";

export function createMascot() {
  const group = new Group(); group.position.set(3.8, .22, 5.5);
  let disposed = false, generation = 0, mixer: AnimationMixer | undefined;
  function clear() {
    mixer?.stopAllAction(); if (mixer) mixer.uncacheRoot(mixer.getRoot()); mixer = undefined;
    disposeTree(group); group.clear();
  }
  function robot() {
    const body = new Mesh(new SphereGeometry(.45, 20, 14), new MeshStandardMaterial({ color: "#7563dc", roughness: .35, metalness: .2 }));
    body.position.y = .9; body.scale.set(1, 1.1, .85); body.castShadow = true; group.add(body);
    const face = new Mesh(new SphereGeometry(.32, 20, 12), new MeshStandardMaterial({ color: "#152b46", roughness: .2 }));
    face.position.set(0, .96, .24); face.scale.z = .35; group.add(face);
    const eyes = new MeshStandardMaterial({ color: "#a7fff2", emissive: "#5df1e0", emissiveIntensity: .8 });
    for (const x of [-.12, .12]) {
      const eye = new Mesh(new SphereGeometry(.055, 10, 8), eyes); eye.position.set(x, 1, .35); group.add(eye);
    }
  }
  robot();
  function set(value: CityMascot) {
    const ticket = ++generation;
    clear(); robot();
    if (!value.gender) return;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    void loader.loadAsync(value.gender === "female" ? femaleUrl : maleUrl).then(gltf => {
      if (disposed || generation !== ticket) { gltf.scenes.forEach(disposeTree); return; }
      clear();
      const model = gltf.scene, bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
      const scale = 1.9 / Math.max(size.y, .01); model.scale.setScalar(scale); model.position.y = -bounds.min.y * scale;
      model.traverse(o => { if (o instanceof Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      group.add(model);
      if (gltf.animations.length) {
        mixer = new AnimationMixer(model);
        const idle = gltf.animations.find(a => /idle/i.test(a.name)) ?? gltf.animations[0];
        mixer.clipAction(idle).play();
      }
    }).catch(() => { /* The built-in Pulsar remains usable if a character fails to load. */ });
  }
  return { group, set, update: (dt: number) => mixer?.update(dt), dispose() { disposed = true; ++generation; clear(); } };
}
