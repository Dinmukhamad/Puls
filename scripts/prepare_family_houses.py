"""Turn the CC0 Blend Swap "Family House Collection" (#92125) into the district's ready houses.

Usage (Blender 4.2 as the `bpy` module or inside Blender):
    python scripts/prepare_family_houses.py houses_blendswap.blend family-houses.glb
then pack it with frontend/scripts/pack-city-model.mjs.

The source has six modern family houses, each twice: a game version baked onto one trim sheet and
the detailed one, whose windows, doors, garage doors, railings, chimneys and columns are objects of
their own over a per-house ambient occlusion map. The game version of the first house maps parts of
its walls onto the windows of the sheet, so every house is built here from its detailed version:
the house and all its parts joined into one mesh on the sheet's UVs (the occlusion maps and bump
are left off; the baked sheets already carry their relief), and the glass of the fifth house mapped
onto a pane of the sheet. The sheet comes in two finishes with the same layout, brick and stone, so
every house is exported in both: scenes family-house-<n>-brick and family-house-<n>-stone, each one
mesh, one material.

The windows carry a seed per window (attribute _WINDOWSEED, 0 elsewhere): the city lights them at
night like the windows of its other houses (assets/catalogue.ts). Each scene is in the house's own
frame: the middle of its footprint on the ground, its front (the source's -y, where the entrance
and the garage are) towards glTF +z, in source units (about 4 m; the city scales it). The script
prints each house's size and where its front door and garage are, for world/familyHouses.ts. The
license is recorded beside the output model (LICENSE-family-houses.txt). The bpy module of Blender
4.2 may crash on exit after this has printed: the file is complete by then.
"""

import json
import re
import sys
import zlib
from pathlib import Path

import bpy  # first: the bpy module puts bmesh and mathutils on the path  # isort: skip

from mathutils import Matrix, Vector

HOUSES = 6
#: The trim sheets: the same layout in brick and in stone, relief baked in.
FINISHES = {"brick": "house_a_bake.png", "stone": "house_b_bake.png"}
#: A dark pane of the sheet's window (u, v), for glass the source paints with a plain material.
PANE = (0.795, 0.935)
#: Upright windows light at night; roof lights stay dark (the city's rule for its other houses too).
WINDOW = re.compile(r"^window(?!_roof)")
TEXTURE_SIZE = 1024


def args():
    rest = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(rest) != 2:
        raise SystemExit(__doc__)
    return Path(rest[0]).resolve(), Path(rest[1]).resolve()


def finish(name, image_name):
    image = bpy.data.images[image_name]
    if tuple(image.size) != (TEXTURE_SIZE, TEXTURE_SIZE):
        image.scale(TEXTURE_SIZE, TEXTURE_SIZE)
    mat = bpy.data.materials.new(f"family-house-{name}")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def seed(name):
    """A window's own number in (0, 1], the same on every run."""
    return 0.002 + 0.998 * (zlib.crc32(name.encode()) % 10_000) / 10_000


def part(obj, depsgraph):
    """The part's mesh in world space on the sheet's UVs, windows seeded, glass on a pane."""
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh.transform(obj.matrix_world)
    sheet = mesh.uv_layers.get("diffuse") or mesh.uv_layers[0]
    glass = {i for i, m in enumerate(mesh.materials) if m and m.name.startswith("glass")}
    for poly in mesh.polygons:
        if poly.material_index in glass:
            for k in poly.loop_indices:
                sheet.data[k].uv = PANE
    for layer in [layer for layer in mesh.uv_layers if layer.name != sheet.name]:
        mesh.uv_layers.remove(layer)
    sheet = mesh.uv_layers[0]
    sheet.name = "UVMap"
    lit = mesh.attributes.new("_WINDOWSEED", "FLOAT", "POINT")
    value = seed(obj.name) if WINDOW.match(obj.name) else 0.0
    for i in range(len(mesh.vertices)):
        lit.data[i].value = value
    if glass:
        # The plain glass of a facade: each pane of it a window of its own.
        for poly in mesh.polygons:
            if poly.material_index in glass and abs(poly.normal.z) < 0.5:
                for v in poly.vertices:
                    lit.data[v].value = seed(f"{obj.name}:{poly.index}")
    mesh.materials.clear()
    return mesh


def bounds(meshes):
    pts = [v.co for m in meshes for v in m.vertices]
    return (
        Vector([min(p[i] for p in pts) for i in range(3)]),
        Vector([max(p[i] for p in pts) for i in range(3)]),
    )


def centre_x(obj):
    """The part's middle across the front and its front-most y."""
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return sum(p.x for p in pts) / len(pts), min(p.y for p in pts)


def on_ground(obj, ground):
    """Doors one walks in by: the balcony doors upstairs do not count."""
    return min((obj.matrix_world @ Vector(c)).z for c in obj.bound_box) < ground + 0.15


def scene_with(name, meshes, material, frame, scene=None):
    """A scene (new unless given) with the meshes joined into one object in the house's frame."""
    scene = scene or bpy.data.scenes.new(name)
    scene.name = name
    objects = []
    for mesh in meshes:
        mesh = mesh.copy()
        mesh.transform(frame)
        mesh.materials.append(material)
        mesh.validate()
        obj = bpy.data.objects.new(mesh.name, mesh)
        scene.collection.objects.link(obj)
        objects.append(obj)
    with bpy.context.temp_override(
        scene=scene,
        view_layer=scene.view_layers[0],
        active_object=objects[0],
        selected_editable_objects=objects,
    ):
        bpy.ops.object.join()
    joined = objects[0]
    joined.name = name
    root = bpy.data.objects.new(f"{name}-root", None)
    scene.collection.objects.link(root)
    joined.parent = root
    return scene, joined


def main():
    source, target = args()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    materials = {name: finish(name, image) for name, image in FINISHES.items()}
    houses, info = [], {}
    for n in range(1, HOUSES + 1):
        body = bpy.data.objects[f"house{n}"]
        parts = [body, *[o for o in body.children_recursive if o.type == "MESH"]]
        meshes = [part(obj, depsgraph) for obj in parts]
        lo, hi = bounds(meshes)
        # The middle of the footprint on the ground; the front (-y) becomes glTF +z on export.
        middle = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        frame = Matrix.Translation(-middle)
        doors = [o for o in parts if o.name.startswith("door") and on_ground(o, lo.z)]
        garages = [o for o in parts if o.name.startswith("garage_door") and on_ground(o, lo.z)]
        front = lo.y
        entrance = min(doors, key=lambda o: centre_x(o)[1]) if doors else None
        garage = min(garages, key=lambda o: centre_x(o)[1]) if garages else None
        info[n] = {
            "width": round(hi.x - lo.x, 3),
            "depth": round(hi.y - lo.y, 3),
            "height": round(hi.z - lo.z, 3),
            # Along the front (glTF x is the source's x), and how far back from the front they are.
            "door": entrance
            and [
                round(centre_x(entrance)[0] - middle.x, 3),
                round(centre_x(entrance)[1] - front, 3),
            ],
            "garage": garage
            and [round(centre_x(garage)[0] - middle.x, 3), round(centre_x(garage)[1] - front, 3)],
        }
        houses.append((n, meshes, frame))
    # Only the new parts are exported: the source's objects go.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scenes, triangles = [], 0
    for n, meshes, frame in houses:
        for name, material in materials.items():
            scene, joined = scene_with(
                f"family-house-{n}-{name}",
                meshes,
                material,
                frame,
                bpy.context.scene if not scenes else None,
            )
            scenes.append(scene)
            joined.data.calc_loop_triangles()
            triangles += len(joined.data.loop_triangles)
            info[n]["triangles"] = len(joined.data.loop_triangles)
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
        export_image_format="JPEG",
        export_jpeg_quality=82,
    )
    print(json.dumps(info, indent=1))
    print(f"wrote {target} ({target.stat().st_size} bytes, {triangles} triangles in all)")


main()
