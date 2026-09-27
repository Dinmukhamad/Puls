import { Color, Mesh, MeshStandardNodeMaterial, PlaneGeometry } from "three/webgpu";
import { color, float, mix, positionWorld, smoothstep, uniform } from "three/tsl";

/** Analytic ripples share one material on WebGPU and WebGL2; no reflection render pass. */
export function createWater() {
  const clock = uniform(0), night = uniform(0);
  const p = positionWorld;
  const ripple = p.x.mul(.85).add(p.z.mul(1.6)).add(clock.mul(.7)).sin()
    .mul(p.z.mul(.66).sub(clock.mul(.4)).sin()).mul(.5).add(.5);
  const coast = float(1).sub(smoothstep(18, 22, p.xz.length()));
  const day = mix(color("#167f9e"), color("#67cfc4"), coast.mul(.58).add(ripple.mul(.08)));
  const evening = mix(color("#142c4b"), color("#39768c"), coast.mul(.6).add(ripple.mul(.05)));
  const material = new MeshStandardNodeMaterial({ roughness: .32, metalness: .18 });
  material.colorNode = mix(day, evening, night);
  // Modest self-illumination keeps water readable at night without expensive lights.
  material.emissive = new Color("#0b263b");
  material.emissiveIntensity = .25;
  const mesh = new Mesh(new PlaneGeometry(2000, 2000), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -.65;
  mesh.receiveShadow = true;
  return { mesh, update: (time: number) => { clock.value = time; }, setNight: (value: boolean) => { night.value = value ? 1 : 0; } };
}
