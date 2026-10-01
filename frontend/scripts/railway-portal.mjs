/**
 * Packs the tunnel portal for the city (systems/departmentWorld.ts) from the Blender export of
 * scripts/prepare_railway_portal.py: welded, deduplicated, meshopt-compressed with quantised attributes like
 * the other city models (assets/loader.ts decodes them and expands the attributes to floats for WebGPU).
 *
 *   node scripts/railway-portal.mjs <blender-export.glb> src/pages/city/models/railway-portal.glb
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error("usage: node scripts/railway-portal.mjs <blender-export.glb> <railway-portal.glb>");
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(source);
await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(target, doc);
const bytes = (await io.writeBinary(doc)).byteLength;
console.log(`wrote ${target} (${bytes} bytes)`);
