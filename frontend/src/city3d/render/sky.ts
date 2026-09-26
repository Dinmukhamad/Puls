/**
 * Sky and sunlight (TZ §6.3): a TSL sky dome (the scene background, a gradient from the horizon to the
 * zenith with the sun's disc and glow), fog of the horizon colour so the city melts into it, the sky and
 * ground fill (HemisphereLight) and one warm sun about 35° high, from the old city's direction, so shadows
 * fall towards the viewer's lower left. The sun's shadow map is static: drawn once and again on
 * ctx.requestShadowUpdate() (engine/renderer.ts setStaticShadows). There is no scene.environment: its even
 * light fills the shade and the shadows disappear; the water reads the sky from `gradient` instead.
 */
import * as THREE from "three/webgpu";
import { Fn, dot, float, max, mix, pow, positionWorldDirection, smoothstep, uniform, type ShaderNodeObject } from "three/tsl";
import type { CityContext } from "../engine/context";
import type { QualitySettings } from "../engine/qualityTypes";
import { requestShadowRedraw, setStaticShadows } from "../engine/renderer";

type Vec3Node = ShaderNodeObject<THREE.Node>;
export interface Sky {
  sun: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  /** Sky colour without the sun in a world direction, for reflections. */
  gradient(direction: Vec3Node): Vec3Node;
  /** Unit vector towards the sun and its colour × intensity, for the water's glint. */
  sunDirection: ShaderNodeObject<THREE.UniformNode<THREE.Vector3>>;
  sunColor: ShaderNodeObject<THREE.UniformNode<THREE.Color>>;
  /** Moves the sun for a time of day (a stage 3 stub: the colours stay the day's). */
  setTimeOfDay(hours: number): void;
  dispose(): void;
}

const HORIZON = "#d6e9ef", ZENITH = "#86bfe4", SUN = "#ffe4bd", SUN_INTENSITY = 3.3;
/** The old city's sun, seen from the plaza: 36.5° high, from the far left of the default view. */
const SUN_POSITION = new THREE.Vector3(-52, 46, 34);
/** The time of day that gives exactly that sun; setTimeOfDay moves it 15° an hour. */
export const DEFAULT_HOURS = 10.5;
/** The shadow map covers at most this far from the plaza: beyond, the fog and the LOD take over. */
const SHADOW_REACH = 130;

export function createSky(ctx: CityContext): Sky {
  const { scene, world } = ctx;
  const horizon = uniform(new THREE.Color(HORIZON)), zenith = uniform(new THREE.Color(ZENITH));
  const sunDirection = uniform(SUN_POSITION.clone().normalize()), sunColor = uniform(new THREE.Color(SUN).multiplyScalar(SUN_INTENSITY));

  // Brighter towards the horizon, deeper blue overhead; below the horizon the fog colour, like the ground far away.
  const gradient = Fn(([direction]: [Vec3Node]) => {
    const up = max(direction.y, float(0));
    return mix(horizon, zenith, smoothstep(0, .55, pow(up, .8)));
  }) as unknown as (direction: Vec3Node) => Vec3Node;
  const background = Fn(() => {
    const direction = positionWorldDirection, toward = max(dot(direction, sunDirection), float(0));
    // A small white-hot disc and a warm glow around it.
    const disc = smoothstep(.99955, .9998, toward).mul(8), glow = pow(toward, float(48)).mul(.35).add(pow(toward, float(6)).mul(.08));
    return gradient(direction).add(sunColor.mul(disc.add(glow).div(SUN_INTENSITY)));
  })();
  const sceneNodes = scene as THREE.Scene & { backgroundNode: THREE.Node | null };
  sceneNodes.backgroundNode = background;
  // The fog matches the horizon, so land and sky meet without a seam; it scales with the world (v1: 118…330).
  scene.fog = new THREE.Fog(HORIZON, world.radius * .79, world.radius * 2.2);

  // A warm late-morning sun, low enough for long shadows; the sky and the grass fill the shade softly.
  const hemisphere = new THREE.HemisphereLight("#d9ebff", "#71805c", 1.15);
  const sun = new THREE.DirectionalLight(SUN, SUN_INTENSITY);
  const reach = Math.min(world.radius, SHADOW_REACH), distance = reach + 60;
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: Math.max(1, distance - reach * 1.5), far: distance + reach * 1.5 });
  scene.add(hemisphere, sun);

  /** Map size from quality; the bias follows the texel size, so bigger maps keep crisp contact shadows. */
  function shadowSize(q: QualitySettings) {
    const size = q.staticShadowSize, texel = reach * 2 / size;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.setScalar(size); requestShadowRedraw(sun); }
    sun.shadow.normalBias = .02 + texel * .6; sun.shadow.bias = -.0004;
  }
  shadowSize(ctx.quality);
  setStaticShadows(sun, true);
  const offQuality = ctx.onQuality(shadowSize);

  const azimuth0 = Math.atan2(SUN_POSITION.z, SUN_POSITION.x), elevation0 = Math.asin(SUN_POSITION.y / SUN_POSITION.length());
  const peak = elevation0 / Math.sin(Math.PI * (DEFAULT_HOURS - 6) / 12), noon = new THREE.Color(SUN), dusk = new THREE.Color("#ffb070");
  function setTimeOfDay(hours: number) {
    // Up at 6, highest at noon, down at 18; the sun turns 15° an hour around the city.
    const elevation = peak * Math.sin(Math.PI * (hours - 6) / 12), azimuth = azimuth0 - (hours - DEFAULT_HOURS) * Math.PI / 12;
    const direction = new THREE.Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(Math.max(elevation, -.1)), Math.sin(azimuth) * Math.cos(elevation)).normalize();
    const day = THREE.MathUtils.clamp(elevation / .35, 0, 1);
    sun.position.copy(direction).multiplyScalar(distance);
    sun.color.copy(dusk).lerp(noon, day); sun.intensity = SUN_INTENSITY * THREE.MathUtils.smoothstep(elevation, -.02, .12);
    hemisphere.intensity = .35 + .8 * THREE.MathUtils.smoothstep(elevation, -.15, .3);
    sunDirection.value.copy(direction); sunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    sun.updateMatrixWorld();
    ctx.requestShadowUpdate();
  }
  setTimeOfDay(DEFAULT_HOURS);

  return {
    sun, hemisphere, gradient, sunDirection, sunColor, setTimeOfDay,
    dispose() {
      offQuality();
      scene.remove(hemisphere, sun);
      sun.shadow.dispose(); sun.dispose(); hemisphere.dispose();
      if (sceneNodes.backgroundNode === background) sceneNodes.backgroundNode = null;
      background.dispose();
      scene.fog = null;
    },
  };
}
