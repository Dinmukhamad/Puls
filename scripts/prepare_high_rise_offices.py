"""Prepare Phoenixdraws' CC BY 3.0 High Rise Office Buildings (#74984) for district plots.

    blender -b --factory-startup --disable-autoexec --python scripts/prepare_high_rise_offices.py \
        -- City.blend high-rise-offices.glb
    cd frontend && node scripts/pack-city-model.mjs ../high-rise-offices.glb \
        src/pages/city/models/high-rise-offices.glb

The supplied City.blend contains nine tower bodies (the archive's description says eight).
Each body, including its attached rooftop door, becomes one ground-centred glTF scene. The
source's -Y faces glTF +Z; proportions and repeat UVs are preserved. Legacy Cycles diffuse/
glossy shaders are converted to glTF Principled materials using their packed colour images.
The upright facade faces carry _WINDOWSEED, which the city combines with the facade texture
to light glass at night; roofs, trim and pavement are unmarked. Source cameras, lights and
the 448-unit ground plane are excluded. Attribution is recorded beside the deployed model.
"""

import json
import sys
import zlib
from pathlib import Path

import bpy  # isort: skip
from mathutils import Matrix, Vector

SOURCE_OBJECTS = (
    "Cube.000",
    "Cube.001",
    "Cube.002",
    "Cube.004",
    "Cube.005",
    "Cube.006",
    "Cube.007",
    "Cube.008",
    "Cube.009",
)
FACADES = {"Door", "Door.001", "Sides", "Material.003", "Ground Floor"}
ATTRIBUTION = {
    "title": "High Rise Office Buildings",
    "author": "Phoenixdraws",
    "source": "https://www.blendswap.com/blends/view/74984",
    "license": "CC BY 3.0",
    "license_url": "https://creativecommons.org/licenses/by/3.0/",
    "changes": (
        "Individual ground-centred glTF scenes, converted shaders, window markers, "
        "meshopt compression."
    ),
}


def args():
    rest = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(rest) != 2:
        raise SystemExit(__doc__)
    return Path(rest[0]).resolve(), Path(rest[1]).resolve()


def material(source):
    """Keep the diffuse colour map; pure glossy glass uses its glossy colour map instead."""
    nodes = source.node_tree.nodes
    diffuse = next((n for n in nodes if n.type == "BSDF_DIFFUSE"), None)
    color = diffuse.inputs["Color"] if diffuse else None
    image_node = color.links[0].from_node if color and color.is_linked else None
    if image_node is None or image_node.type != "TEX_IMAGE":
        glossy = next((n for n in nodes if n.type == "BSDF_GLOSSY"), None)
        if glossy and glossy.inputs["Color"].is_linked:
            image_node = glossy.inputs["Color"].links[0].from_node
    image = image_node.image if image_node and image_node.type == "TEX_IMAGE" else None
    result = bpy.data.materials.new("office-" + source.name)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.05 if source.name in FACADES else 0.0
    bsdf.inputs["Roughness"].default_value = 0.48 if source.name in FACADES else 0.85
    bsdf.inputs["Base Color"].default_value = color.default_value if color else source.diffuse_color
    if image:
        texture = result.node_tree.nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.extension = "REPEAT"
        result.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    return result


def seed(name):
    return 0.002 + 0.998 * (zlib.crc32(name.encode()) % 10000) / 10000


def prepare_mesh(objects, frame, materials, number):
    """Split triangle corners so roof and facade markers never bleed over shared vertices."""
    vertices, faces, uvs, seeds, indices = [], [], [], [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        mesh.calc_loop_triangles()
        sheet = mesh.uv_layers.active
        world = frame @ obj.matrix_world
        for tri in mesh.loop_triangles:
            poly = mesh.polygons[tri.polygon_index]
            mat = mesh.materials[tri.material_index]
            normal = obj.matrix_world.to_3x3().inverted().transposed() @ poly.normal
            normal.normalize()
            lit = mat.name in FACADES and abs(normal.z) < 0.5
            value = seed(f"{number}:{obj.name}:{poly.index}") if lit else 0.0
            face = []
            for loop in tri.loops:
                face.append(len(vertices))
                vertices.append(world @ mesh.vertices[mesh.loops[loop].vertex_index].co)
                uvs.append(tuple(sheet.data[loop].uv) if sheet else (0.0, 0.0))
                seeds.append(value)
            faces.append(face)
            indices.append(materials.index(mat.name))
        bpy.data.meshes.remove(mesh)
    result = bpy.data.meshes.new(f"office-building-{number}")
    result.from_pydata(vertices, [], faces)
    result.update()
    uv = result.uv_layers.new(name="UVMap")
    marker = result.attributes.new("_WINDOWSEED", "FLOAT", "POINT")
    for i, value in enumerate(seeds):
        marker.data[i].value = value
    for poly, index in zip(result.polygons, indices, strict=True):
        poly.material_index = index
        for k in poly.loop_indices:
            uv.data[k].uv = uvs[result.loops[k].vertex_index]
    return result


def main():
    source, target = args()
    bpy.ops.wm.open_mainfile(filepath=str(source), use_scripts=False)
    missing = set(SOURCE_OBJECTS) - set(bpy.data.objects.keys())
    if missing:
        raise ValueError(f"Source buildings missing: {sorted(missing)}")
    source_materials = list(bpy.data.materials)
    names = [m.name for m in source_materials]
    converted = [material(m) for m in source_materials]
    prepared, info = [], []
    for number, name in enumerate(SOURCE_OBJECTS, 1):
        body = bpy.data.objects[name]
        objects = [body, *[o for o in body.children_recursive if o.type == "MESH"]]
        points = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
        lo = Vector([min(p[k] for p in points) for k in range(3)])
        hi = Vector([max(p[k] for p in points) for k in range(3)])
        middle = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        mesh = prepare_mesh(objects, Matrix.Translation(-middle), names, number)
        for mat in converted:
            mesh.materials.append(mat)
        prepared.append(mesh)
        info.append(
            {
                "family": "office" + chr(96 + number),
                "model": number,
                "source": name,
                "width": round(hi.x - lo.x, 6),
                "depth": round(hi.y - lo.y, 6),
                "height": round(hi.z - lo.z, 6),
                "triangles": len(mesh.polygons),
            }
        )
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    # Keep exactly nine scenes: Blender files may carry spare scenes, cameras and display layers.
    current = bpy.context.scene
    for scene in list(bpy.data.scenes):
        if scene != current:
            bpy.data.scenes.remove(scene)
    for number, mesh in enumerate(prepared, 1):
        name = f"office-building-{number}"
        scene = current if number == 1 else bpy.data.scenes.new(name)
        scene.name = name
        scene["attribution"] = json.dumps(ATTRIBUTION)
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_active_scene=False,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_attributes=True,
        export_extras=True,
        export_image_format="JPEG",
        export_jpeg_quality=82,
    )
    metadata = target.with_suffix(".json")
    metadata.write_text(json.dumps({"attribution": ATTRIBUTION, "models": info}, indent=2) + "\n")
    print(json.dumps(info, indent=2))
    print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
