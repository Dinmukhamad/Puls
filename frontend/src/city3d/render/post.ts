/**
 * Post effects (TZ §6.6) as one THREE.PostProcessing pipeline of TSL nodes: the scene pass, ambient
 * occlusion (GTAO at half resolution, quality `ao`), a glow on lamps and windows (quality `bloom`) and
 * antialiasing, since the renderer draws without MSAA: quality `antialias` (SMAA on the strong tiers, FXAA
 * below), none on screens of twice the density or more, where edges are already fine and a full-screen pass
 * costs the most. With nothing on, render() is a plain renderer.render(): no extra render target, no extra
 * pass. The glow is built only once the night falls (TZ §6.7): by day it barely showed and its passes cost
 * every frame. At night it grows with ctx.night.level; tiers without bloom keep it off, and the lights read by
 * their own emissive colours. The corner shading fades out past the city (AO_FADE, docs/CITY_V4.md stage 3):
 * farther away its samples are finer than a pixel and only laid a grid of noise over the hazy hills. No other
 * passes (tilt-shift, grading, TRAA): quality `tiltShift` stays unused.
 */
import * as THREE from "three/webgpu";
import { mix, pass, renderOutput, smoothstep, vec4, type ShaderNodeObject } from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import type { CityContext } from "../engine/context";

// GTAONode r180 supports null to reconstruct normals from depth; @types omits that overload.
const depthAO = ao as (depth: THREE.Node, normal: THREE.Node | null, camera: THREE.PerspectiveCamera) => ReturnType<typeof ao>;

export type Antialias = "smaa" | "fxaa" | "none";
export interface PostOptions {
  /** Overrides the automatic choice (SMAA; FXAA on "low"; none at a pixel ratio of 2 or more). */
  antialias?: Antialias;
}
export interface Post {
  /** Draws the frame: through the pipeline, or straight to the canvas when every effect is off. */
  render(): void;
  /** Call after the canvas or its pixel ratio changed; the effects size themselves from the renderer. */
  setSize(width: number, height: number): void;
  /** The effects in use, e.g. "ao+bloom+smaa", or "" for a plain render. */
  readonly effects: string;
  dispose(): void;
}

interface Pipeline { post: THREE.PostProcessing; nodes: THREE.Node[]; targets: THREE.RenderTarget[]; key: string; glow: ReturnType<typeof bloom> | null }

/** The corner shading fades out between these distances from the camera, in world radii (the city, then its hills). */
export const AO_FADE = [.65, 1.25] as const;
/** Bloom strength and threshold as the night falls and at full night: windows, lamps and headlights glow clearly. */
export const BLOOM_DAY = { strength: .26, threshold: .92 }, BLOOM_NIGHT = { strength: .65, threshold: .72 };

export function createPost(ctx: CityContext, options: PostOptions = {}): Post {
  const { renderer, scene, camera } = ctx;
  let pipeline: Pipeline | null = null, key = "";

  const antialias = (): Antialias => options.antialias ?? (renderer.getPixelRatio() >= 2 ? "none" : ctx.quality.antialias);
  /** The glow is wanted while the night level is above zero, on tiers that have it. */
  const glowWanted = () => ctx.quality.bloom && (ctx.night.level.value as number) > 0;
  /** Rebuilds the pipeline when the set of effects changed. */
  function build() {
    const q = ctx.quality, glowing = glowWanted(), next = [q.ao && "ao", glowing && "bloom", antialias()].filter(e => e && e !== "none").join("+");
    if (next === key && (pipeline || !next)) return;
    teardown(); key = next;
    if (!next) return;
    const nodes: THREE.Node[] = [], targets: THREE.RenderTarget[] = [];
    let glow: Pipeline["glow"] = null;
    const scenePass = pass(scene, camera); nodes.push(scenePass);
    let color = scenePass.getTextureNode("output") as unknown as ShaderNodeObject<THREE.Node>;
    if (q.ao) {
      // Corner shading of the old trial look (radius 1.6 units, blended at 85%), at half resolution.
      // Reconstruct normals from depth. In r180 the background's WebGPU pipeline
      // can retain two MRT attachments after adaptive quality disables AO, while
      // the new pass has only one, invalidating every frame. A single colour
      // attachment throughout keeps quality changes valid and saves a normal buffer.
      const occlusion = depthAO(scenePass.getTextureNode("depth"), null, camera);
      occlusion.resolutionScale = .5;
      occlusion.radius.value = .9; occlusion.thickness.value = 2; occlusion.distanceExponent.value = 1.4; occlusion.scale.value = .8; occlusion.samples.value = 12;
      nodes.push(occlusion);
      // Corner shading belongs to the city: past it (AO_FADE world radii from the camera) its samples grow finer
      // than a pixel and only lay a grid of noise over the hazy hills, so it fades out there.
      const texel = scenePass.getTextureNode("output"), radius = ctx.world.radius;
      const near = smoothstep(radius * AO_FADE[0], radius * AO_FADE[1], scenePass.getViewZNode().negate()).oneMinus();
      color = vec4(texel.rgb.mul(mix(1, occlusion.getTextureNode().r, near.mul(.5))), texel.a);
    }
    if (glowing) {
      // Glow is emitted light: extract it before occlusion dims the scene.
      glow = bloom(scenePass.getTextureNode("output"), BLOOM_DAY.strength, .55, BLOOM_DAY.threshold); nodes.push(glow);
      color = color.add(glow);
    }
    const post = new THREE.PostProcessing(renderer);
    const aa = antialias();
    if (aa === "smaa") {
      // SMAA works on linear colour, before tone mapping and sRGB.
      const node = smaa(color); nodes.push(node); post.outputNode = node;
      rttTarget(node, targets);
    } else if (aa === "fxaa") {
      // FXAA wants the final sRGB image.
      post.outputColorTransform = false;
      const node = fxaa(renderOutput(color)); nodes.push(node); post.outputNode = node;
      rttTarget(node, targets);
    } else post.outputNode = color;
    pipeline = { post, nodes, targets, key: next, glow };
    bloomLevel = NaN;
  }
  /** Follows the night level before each frame: two uniform writes while it changes, nothing otherwise. */
  let bloomLevel = NaN;
  function nightBloom() {
    const glow = pipeline?.glow, level = ctx.night.level.value as number;
    if (!glow || level === bloomLevel) return;
    bloomLevel = level;
    glow.strength.value = THREE.MathUtils.lerp(BLOOM_DAY.strength, BLOOM_NIGHT.strength, level);
    glow.threshold.value = THREE.MathUtils.lerp(BLOOM_DAY.threshold, BLOOM_NIGHT.threshold, level);
  }
  function teardown() {
    if (!pipeline) return;
    pipeline.post.dispose();
    pipeline.nodes.forEach(disposeNode);
    pipeline.targets.forEach(target => target.dispose());
    pipeline = null;
  }

  build();
  const offQuality = ctx.onQuality(build);

  return {
    render() {
      // Nightfall adds the glow's passes and daybreak removes them; nothing changes in between.
      if (glowWanted() !== !!pipeline?.glow) build();
      if (pipeline) { nightBloom(); pipeline.post.render(); } else renderer.render(scene, camera);
    },
    setSize() { build(); },
    get effects() { return key; },
    dispose() { offQuality(); teardown(); key = ""; },
  };
}

/** Three's effect nodes leave some internals behind in dispose(): GTAO its noise texture, bloom its materials. */
function disposeNode(node: THREE.Node) {
  node.dispose();
  const left = node as unknown as { _noiseNode?: { value?: THREE.Texture }; _highPassFilterMaterial?: THREE.Material | null; _compositeMaterial?: THREE.Material | null; _separableBlurMaterials?: THREE.Material[] };
  left._noiseNode?.value?.dispose();
  left._highPassFilterMaterial?.dispose(); left._compositeMaterial?.dispose(); left._separableBlurMaterials?.forEach(m => m.dispose());
}

/** An input that is not a texture yet is first drawn into its own target (RTTNode), which needs freeing too. */
function rttTarget(node: THREE.Node, targets: THREE.RenderTarget[]) {
  const target = (node as THREE.Node & { textureNode?: { renderTarget?: THREE.RenderTarget } }).textureNode?.renderTarget;
  if (target) targets.push(target);
}
