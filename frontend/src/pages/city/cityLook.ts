import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * The trial "game" look of the city: soft contact shadows in corners (GTAO), a glow on lamps and windows,
 * a miniature-style tilt-shift blur at the top and bottom of the frame, warm grading and a vignette.
 * It is drawn into a multisampled target, so edges stay smooth. Opened with ?look=new for comparison.
 */
const tiltShift = {
  uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2() }, focus: { value: .56 }, band: { value: .3 }, amount: { value: 2.4 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 direction; uniform float focus, band, amount; varying vec2 vUv;
    void main() {
      // Sharp in a band across the middle of the frame, blurred towards the top and bottom edges.
      float blur = smoothstep(0.0, 1.0, max(0.0, abs(vUv.y - focus) - band * .5) / (1.0 - band)) * amount;
      vec4 sum = vec4(0.0); float total = 0.0;
      for (int i = -4; i <= 4; i++) { float w = 1.0 - abs(float(i)) / 5.0; sum += texture2D(tDiffuse, vUv + direction * float(i) * blur) * w; total += w; }
      gl_FragColor = sum / total;
    }`,
};
const grade = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: tiltShift.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // A warm afternoon: lift the shadows a touch towards blue, warm the highlights, add a little saturation.
      float l = dot(c.rgb, vec3(.2126, .7152, .0722));
      c.rgb = mix(vec3(l), c.rgb, 1.12);
      c.rgb += vec3(.018, .008, -.012) * smoothstep(.35, 1.0, l) + vec3(-.006, .0, .014) * (1.0 - smoothstep(.0, .35, l));
      float v = smoothstep(.95, .35, distance(vUv, vec2(.5)));
      c.rgb *= mix(.82, 1.0, v);
      gl_FragColor = c;
    }`,
};

export function createCinematicLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, lite: boolean) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let ao: GTAOPass | null = null;
  if (!lite) {
    ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 2, scale: 1.1, samples: 12 });
    ao.blendIntensity = .85;
    composer.addPass(ao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .32, .55, .92);
  composer.addPass(bloom);
  const horizontal = new ShaderPass(tiltShift), vertical = new ShaderPass(tiltShift);
  composer.addPass(horizontal); composer.addPass(vertical);
  composer.addPass(new ShaderPass(grade));
  composer.addPass(new OutputPass());

  // Water reflects a soft sky and lamps glow brighter, so the bloom picks them up.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const sky = new THREE.Scene(); sky.background = new THREE.Color("#bcd8ee");
  const skyEnv = pmrem.fromScene(sky, .1); pmrem.dispose();
  const tuned = new Set<THREE.Material>();
  function tune(root: THREE.Object3D) {
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of [o.material].flat()) {
        if (!(m instanceof THREE.MeshStandardMaterial) || tuned.has(m)) continue;
        tuned.add(m);
        if (m.map && m.roughness <= .3) { m.envMap = skyEnv.texture; m.envMapIntensity = .9; m.roughness = .12; m.metalness = .2; m.needsUpdate = true; }
        if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) m.emissiveIntensity = Math.max(m.emissiveIntensity, 2.4);
      }
    });
  }

  return {
    tune,
    setSize(width: number, height: number, ratio: number) {
      composer.setPixelRatio(ratio); composer.setSize(width, height);
      const w = width * ratio, h = height * ratio;
      horizontal.uniforms.direction.value.set(1 / w, 0); vertical.uniforms.direction.value.set(0, 1 / h);
    },
    render() { composer.render(); },
    dispose() { composer.dispose(); target.dispose(); ao?.dispose(); bloom.dispose(); skyEnv.dispose(); },
  };
}
