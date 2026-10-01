/**
 * Packs a model for the city (systems/departmentWorld.ts) from a Blender export: the tunnel portal of
 * scripts/prepare_railway_portal.py, the station of scripts/prepare_railway_station.py. Welded, deduplicated,
 * meshopt-compressed with quantised attributes like the other city models (assets/loader.ts decodes them and
 * expands the attributes to floats for WebGPU).
 *
 *   node scripts/pack-city-model.mjs <blender-export.glb> src/pages/city/models/railway-portal.glb
 *   node scripts/pack-city-model.mjs <blender-export.glb> src/pages/city/models/railway-station.glb
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error("usage: node scripts/pack-city-model.mjs <blender-export.glb> <model.glb>");
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(source);
await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(target, doc);
const bytes = (await io.writeBinary(doc)).byteLength;
console.log(`wrote ${target} (${bytes} bytes)`);
