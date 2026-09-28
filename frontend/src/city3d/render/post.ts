/**
 * Post effects (TZ §6.6) as one THREE.PostProcessing pipeline of TSL nodes: the scene pass, ambient
 * occlusion (GTAO at half resolution, quality `ao`), a glow on lamps and windows (quality `bloom`) and
 * antialiasing, since the renderer draws without MSAA: SMAA, FXAA on "low", none on screens of twice the
 * density or more, where edges are already fine and a full-screen pass costs the most. With nothing on,
 * render() is a plain renderer.render(): no extra render target, no extra pass. At night (TZ §6.7) the
 * glow grows stronger and takes dimmer lights with ctx.night.level; tiers without bloom keep it off, and
 * the lights read by their own emissive colours. Tilt-shift, grading and TRAA come with the content of stage 3.
 */
import * as THREE from "three/webgpu";
import { mix, pass, renderOutput, vec4, type ShaderNodeObject } from "three/tsl";
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

/** Bloom strength and threshold by day and at full night: at night windows, lamps and headlights glow clearly. */
export const BLOOM_DAY = { strength: .32, threshold: .92 }, BLOOM_NIGHT = { strength: .9, threshold: .6 };

export function createPost(ctx: CityContext, options: PostOptions = {}): Post {
  const { renderer, scene, camera } = ctx;
  let pipeline: Pipeline | null = null, key = "";

  const antialias = (): Antialias => options.antialias ?? (renderer.getPixelRatio() >= 2 ? "none" : ctx.quality.tier === "low" ? "fxaa" : "smaa");
  /** Rebuilds the pipeline when the set of effects changed. */
  function build() {
    const q = ctx.quality, next = [q.ao && "ao", q.bloom && "bloom", antialias()].filter(e => e && e !== "none").join("+");
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
      occlusion.radius.value = 1.4; occlusion.thickness.value = 2; occlusion.distanceExponent.value = 1.4; occlusion.scale.value = 1.1; occlusion.samples.value = 12;
      nodes.push(occlusion);
      const texel = scenePass.getTextureNode("output");
      color = vec4(texel.rgb.mul(mix(1, occlusion.getTextureNode().r, .85)), texel.a);
    }
    if (q.bloom) {
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
    render() { if (pipeline) { nightBloom(); pipeline.post.render(); } else renderer.render(scene, camera); },
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
