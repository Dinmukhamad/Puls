/**
 * Post effects (TZ §6.6) as one THREE.PostProcessing pipeline of TSL nodes: the scene pass, ambient
 * occlusion (GTAO at half resolution, quality `ao`), a glow on lamps and windows (quality `bloom`) and
 * antialiasing, since the renderer draws without MSAA: SMAA, FXAA on "low", none on screens of twice the
 * density or more, where edges are already fine and a full-screen pass costs the most. With nothing on,
 * render() is a plain renderer.render(): no extra render target, no extra pass. Tilt-shift, grading and
 * TRAA come with the content of stage 3.
 */
import * as THREE from "three/webgpu";
import { mix, mrt, normalView, output, pass, renderOutput, vec4, type ShaderNodeObject } from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import { fxaa } from "three/examples/jsm/tsl/display/FXAANode.js";
import type { CityContext } from "../engine/context";

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

interface Pipeline { post: THREE.PostProcessing; nodes: THREE.Node[]; targets: THREE.RenderTarget[]; key: string }

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
    const scenePass = pass(scene, camera); nodes.push(scenePass);
    if (q.ao) scenePass.setMRT(mrt({ output, normal: normalView }));
    let color = scenePass.getTextureNode("output") as unknown as ShaderNodeObject<THREE.Node>;
    if (q.ao) {
      // Corner shading of the old trial look (radius 1.6 units, blended at 85%), at half resolution.
      const occlusion = ao(scenePass.getTextureNode("depth"), scenePass.getTextureNode("normal"), camera);
      occlusion.resolutionScale = .5;
      occlusion.radius.value = 1.4; occlusion.thickness.value = 2; occlusion.distanceExponent.value = 1.4; occlusion.scale.value = 1.1; occlusion.samples.value = 12;
      nodes.push(occlusion);
      const texel = scenePass.getTextureNode("output");
      color = vec4(texel.rgb.mul(mix(1, occlusion.getTextureNode().r, .85)), texel.a);
    }
    if (q.bloom) {
      // Only what shines brighter than white glows: lamp bulbs, lit windows at night.
      const glow = bloom(color, .32, .55, .92); nodes.push(glow);
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
    pipeline = { post, nodes, targets, key: next };
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
    render() { if (pipeline) pipeline.post.render(); else renderer.render(scene, camera); },
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
