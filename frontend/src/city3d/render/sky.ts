/**
 * Sky and sunlight (TZ §6.3): a TSL sky dome (the scene background, a gradient from the horizon to the
 * zenith with the sun's disc and glow), fog of the horizon colour so the city melts into it, the sky and
 * ground fill (HemisphereLight) and one warm sun about 35° high, from the old city's direction, so shadows
 * fall towards the viewer's lower left. The sun's shadow map is static: drawn once and again on
 * ctx.requestShadowUpdate() (engine/renderer.ts setStaticShadows). There is no scene.environment: its even
 * light fills the shade and the shadows disappear.
 *
 * At night (TZ §6.7) the dome turns deep blue with a warm glow of the city's lights along the horizon,
 * twinkling stars and a moon: all in the one background shader, faded in by ctx.night.level.
 */
import * as THREE from "three/webgpu";
import { Fn, If, color, dot, exp, float, floor, fract, max, mix, normalize, pow, positionWorldDirection, smoothstep, step, time, uniform, vec3, type ShaderNodeObject } from "three/tsl";
import { FOG_END } from "../world/relief";
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
  /** Daylight or moonlight, with matching sky, fog and fill colours. */
  setTimeOfDay(hours: number): void;
  /** Centres the shadow map near the view's centre (x, z) once the view has moved a third of its reach away, and sizes it to the view distance. */
  followView(x: number, z: number, viewDistance?: number): void;
  /** Moves the fog out with the camera's distance from the view's centre. */
  setViewDistance(viewDistance: number): void;
  dispose(): void;
}

const HORIZON = "#d6e9ef", ZENITH = "#86bfe4", SUN = "#ffe4bd", SUN_INTENSITY = 3.3;
/** The old city's sun, seen from the plaza: 36.5° high, from the far left of the default view. */
const SUN_POSITION = new THREE.Vector3(-52, 46, 34);
/** The time of day that gives exactly that sun; setTimeOfDay moves it 15° an hour. */
export const DEFAULT_HOURS = 10.5;
/** The shadow map covers at most this far from the plaza: beyond, the fog and the LOD take over. */
const SHADOW_REACH = 130;

/**
 * Night: a deep blue dome and fog, and a warm band of city light (light pollution) rising just above the
 * horizon line, where it starts from nothing, so the fogged land still meets the sky without a seam and
 * whatever stands above the horizon shows as a dark silhouette on the glow.
 */
const NIGHT_HORIZON = "#15203f", NIGHT_ZENITH = "#030813", CITY_GLOW = "#6a4524", MOON_LIGHT = "#9fb8ee";
/**
 * The moon disc sits low over the skyline, a little right of the default view: the camera tilts at most to
 * a few degrees above the horizon (MAX_POLAR), so a higher moon would never be seen. The moonlight keeps
 * the sun's higher path.
 */
const MOON_AZIMUTH = 1.19, MOON_ELEVATION = .045, MOON_RADIUS = .0125;
/** Stars: cells of about 5 px at 1440 × 900, a star in every 36th of them. */
const STAR_GRID = 260, STAR_SHARE = .028;

/** Hash without sine (D. Hoskins): 0…1 from a vec3, the same on every GPU and both backends, negative cells too. */
function hash3(p: Vec3Node): Vec3Node {
  const p3 = fract(p.mul(.1031)), q = p3.add(dot(p3, p3.zyx.add(31.32)));
  return fract(q.x.add(q.y).mul(q.z));
}

export function createSky(ctx: CityContext): Sky {
  const { scene, world } = ctx;
  const horizon = uniform(new THREE.Color(HORIZON)), zenith = uniform(new THREE.Color(ZENITH));
  const sunDirection = uniform(SUN_POSITION.clone().normalize()), sunColor = uniform(new THREE.Color(SUN).multiplyScalar(SUN_INTENSITY));
  // Black by day, so the day's dome stays exactly as it was; `nightSky` 1 swaps the sun's disc for the moon and stars.
  const cityGlow = uniform(new THREE.Color(0)), nightSky = uniform(0);
  const nightFade = nightSky.mul(ctx.night.level);

  // Brighter towards the horizon, deeper blue overhead; below the horizon the fog colour, like the ground far away.
  const gradient = Fn(([direction]: [Vec3Node]) => {
    const up = max(direction.y, float(0));
    return mix(horizon, zenith, smoothstep(0, .55, pow(up, .8))).add(cityGlow.mul(smoothstep(0, .012, up)).mul(exp(up.mul(-22))));
  }) as unknown as (direction: Vec3Node) => Vec3Node;
  /** Twinkling stars, one at a random point of a few grid cells, fewer and dimmer down in the city's glow. */
  const starField = Fn(([direction]: [Vec3Node]) => {
    const p = direction.mul(STAR_GRID), cell = floor(p), h = hash3(cell);
    const jitter = vec3(hash3(cell.add(17.3)), hash3(cell.add(41.9)), hash3(cell.add(73.1)));
    const d = p.sub(normalize(cell.add(jitter.mul(.6).add(.2))).mul(STAR_GRID)).length();
    const bright = max(h.sub(1 - STAR_SHARE).div(STAR_SHARE), float(0)), size = mix(.14, .34, bright);
    const twinkle = ctx.reducedMotion ? float(1) : time.mul(h.mul(3).add(1.2)).add(h.mul(173)).sin().mul(.3).add(.8);
    const shine = step(1 - STAR_SHARE, h).mul(float(1).sub(smoothstep(0, size, d))).mul(pow(bright, float(3)).mul(2.4).add(.35));
    return mix(color("#bcd0ff"), color("#fff0d6"), jitter.x).mul(shine).mul(twinkle).mul(smoothstep(.008, .09, direction.y));
  }) as unknown as (direction: Vec3Node) => Vec3Node;
  const moon = uniform(new THREE.Vector3(Math.cos(MOON_ELEVATION) * Math.cos(MOON_AZIMUTH), Math.sin(MOON_ELEVATION), Math.cos(MOON_ELEVATION) * Math.sin(MOON_AZIMUTH)));
  /** A pale disc with soft grey seas and a faint halo of moonlight around it. */
  const moonDisc = Fn(([direction]: [Vec3Node]) => {
    const toward = max(dot(direction, moon), float(0)), angle = float(1).sub(toward).mul(2).max(0).sqrt();
    const local = direction.sub(moon).div(MOON_RADIUS);
    const seas = local.x.mul(3.1).add(local.z.mul(2.3)).add(1.7).sin().mul(local.y.mul(3.4).sub(local.x.mul(1.4)).sin()).mul(.14).add(.86);
    const disc = float(1).sub(smoothstep(MOON_RADIUS * .88, MOON_RADIUS, angle)).mul(seas).mul(2.2);
    // The halo fades into the horizon haze instead of stopping at the night branch below.
    const halo = pow(toward, float(2600)).mul(.3).add(pow(toward, float(180)).mul(.05)).mul(smoothstep(-.03, .005, direction.y));
    return color("#fff3de").mul(disc).add(color(MOON_LIGHT).mul(halo));
  }) as unknown as (direction: Vec3Node) => Vec3Node;
  const background = Fn(() => {
    const direction = positionWorldDirection, toward = max(dot(direction, sunDirection), float(0));
    // A small white-hot disc and a warm glow around it; at night the moonlight has no disc of its own.
    const disc = smoothstep(.99955, .9998, toward).mul(8), glow = pow(toward, float(48)).mul(.35).add(pow(toward, float(6)).mul(.08));
    const sky = gradient(direction).add(sunColor.mul(disc.add(glow).div(SUN_INTENSITY)).mul(float(1).sub(nightSky))).toVar();
    // The dome is shaded behind the whole frame: stars and moon only where they can show, and not by day.
    If(nightFade.greaterThan(0).and(direction.y.greaterThan(-.03)), () => { sky.addAssign(starField(direction).add(moonDisc(direction)).mul(nightFade)); });
    return sky;
  })();
  const sceneNodes = scene as THREE.Scene & { backgroundNode: THREE.Node | null };
  sceneNodes.backgroundNode = background;
  // The fog matches the horizon, so land and sky meet without a seam; it scales with the world (v1: 118…330).
  scene.fog = new THREE.Fog(HORIZON, world.radius * .79, world.radius * FOG_END);

  // A warm late-morning sun, low enough for long shadows; the sky and the grass fill the shade softly.
  const hemisphere = new THREE.HemisphereLight("#d9ebff", "#71805c", 1.15);
  const sun = new THREE.DirectionalLight(SUN, SUN_INTENSITY);
  // The map covers a square of ±reach: SHADOW_REACH at first, then as much as the view shows (followView).
  let reach = Math.min(world.radius, SHADOW_REACH), distance = reach + 60;
  sun.castShadow = true;
  const frameShadow = () => {
    distance = reach + 80;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: Math.max(1, distance - reach * 1.5), far: distance + reach * 1.5 });
    sun.shadow.camera.updateProjectionMatrix();
  };
  frameShadow();
  scene.add(hemisphere, sun);
  // The shadow map covers a square around `shadowCentre`: the plaza, until the view goes farther out.
  const shadowCentre = new THREE.Vector3(), towardsSun = new THREE.Vector3();
  function aimSun() {
    sun.position.copy(towardsSun).multiplyScalar(distance).add(shadowCentre); sun.target.position.copy(shadowCentre);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  }

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
    hours = Number.isFinite(hours) ? ((hours % 24) + 24) % 24 : DEFAULT_HOURS;
    const night = hours < 6 || hours >= 18;
    // Up at 6, highest at noon, down at 18; the sun turns 15° an hour around the city.
    const elevation = peak * Math.sin(Math.PI * (hours - 6) / 12), azimuth = azimuth0 - (hours - DEFAULT_HOURS) * Math.PI / 12;
    const altitude = night ? Math.max(.45, Math.abs(elevation)) : Math.max(elevation, .04);
    const direction = new THREE.Vector3(Math.cos(azimuth) * Math.cos(altitude), Math.sin(altitude), Math.sin(azimuth) * Math.cos(altitude)).normalize();
    const day = THREE.MathUtils.clamp(elevation / .35, 0, 1);
    towardsSun.copy(direction); aimSun();
    // Moonlight: dim and cool, the sky fill dimmer still, so the lamps and windows carry the night while
    // islands, roads and roofs still read.
    if (night) sun.color.set(MOON_LIGHT); else sun.color.copy(dusk).lerp(noon, day);
    sun.intensity = night ? .8 : SUN_INTENSITY * THREE.MathUtils.smoothstep(elevation, -.02, .12);
    hemisphere.color.set(night ? "#8eaee6" : "#d9ebff");
    hemisphere.groundColor.set(night ? "#262f44" : "#71805c");
    hemisphere.intensity = night ? .55 : .35 + .8 * THREE.MathUtils.smoothstep(elevation, -.15, .3);
    horizon.value.set(night ? NIGHT_HORIZON : HORIZON); zenith.value.set(night ? NIGHT_ZENITH : ZENITH);
    cityGlow.value.set(night ? CITY_GLOW : 0x000000); nightSky.value = night ? 1 : 0;
    (scene.fog as THREE.Fog).color.copy(horizon.value);
    sunDirection.value.copy(direction); sunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    ctx.requestShadowUpdate();
  }
  setTimeOfDay(DEFAULT_HOURS);

  function followView(x: number, z: number, viewDistance = 0) {
    // As much as the view shows, in steps of 30% so zooming a little does not redraw: crisp close by, the whole city from afar.
    const wanted = Math.min(world.radius * 1.05, Math.max(SHADOW_REACH * .55, viewDistance * 1.3)), level = Math.pow(1.3, Math.round(Math.log(wanted) / Math.log(1.3)));
    const resized = viewDistance > 0 && Math.abs(level - reach) > 1e-6;
    if (resized) { reach = level; frameShadow(); shadowSize(ctx.quality); }
    const step = reach / 3;
    if (!resized && Math.hypot(x - shadowCentre.x, z - shadowCentre.z) < step) return;
    // Whole steps, so small moves around a spot never redraw the map.
    shadowCentre.set(Math.round(x / step) * step, 0, Math.round(z / step) * step);
    aimSun(); ctx.requestShadowUpdate();
  }
  /** Fog counts from the view, not the plaza: zoomed out, the city stays clear and only the distance beyond it fades. */
  const fog = scene.fog as THREE.Fog, fogNear = fog.near, fogFar = fog.far;
  function setViewDistance(viewDistance: number) {
    const extra = Math.max(0, viewDistance - 110);
    fog.near = fogNear + extra; fog.far = fogFar + extra;
  }

  return {
    sun, hemisphere, gradient, sunDirection, sunColor, setTimeOfDay, followView, setViewDistance,
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
