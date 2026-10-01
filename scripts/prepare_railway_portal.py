"""Turn the CC0 Blend Swap "Railway Portal" (#81350) into the single-bore tunnel portal of the city.

Usage (Blender 4.2 as the `bpy` module or inside Blender):
    python scripts/prepare_railway_portal.py Tunnel.blend railway-portal.glb
then pack it with frontend/scripts/pack-city-model.mjs.

The source is a twin-bore portal with trains, overhead line and a mountain. The city's line has
one track, so this keeps the left bore with its arch ring and walkways, and makes the stone
headwall, the low side walls and the concrete band symmetric round that bore (their left half and
its mirror image). The bore is cut 40 units in and closed with a dark cap. The result is in the
station's frame (systems/departmentWorld.ts): the origin on the track centre at the rail top in the
headwall's plane, +z (glTF) into the tunnel, sized to the city's track gauge (1.1 against the
source's 1.5). Textures are halved; materials become plain glTF ones. The license is recorded
beside the output model (LICENSE-railway-portal.txt).
"""

import math
import sys
from pathlib import Path

import bpy  # first: the bpy module puts bmesh and mathutils on the path  # isort: skip

import bmesh
from mathutils import Matrix, Vector

KEEP = {
    "DXFmesh.001": "concrete",  # the bore
    "DXFmesh.014": "concrete",  # its arch ring
    "DXFmesh.002": "concrete",  # the walkways inside
    "DXFmesh.016": "concrete",  # the walkways along the cutting
    "DXFmesh.018": "stone",  # headwall and side walls
    "DXFmesh.020": "concrete",  # the side walls' coping
    "DXFmesh.021": "concrete",  # the band round the headwall
}
#: Made symmetric round the bore: the left half and its mirror image.
MIRRORED = {"DXFmesh.018", "DXFmesh.020", "DXFmesh.021"}
CENTRE_X, RAIL_TOP, DEPTH = -0.055, -1.40, 40.0
#: The bore darkens from 3 to 16 units in (before the frame turns it), down to DARK of its colour.
INSIDE, DARK = (3.0, 16.0), 0.12
#: Height of the bore's axis, where the dark cap is centred.
CAP_AXIS = 0.9
SCALE = 1.1 / 1.5


def args():
    rest = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(rest) != 2:
        raise SystemExit(__doc__)
    return Path(rest[0]).resolve(), Path(rest[1]).resolve()


def material(name, image, size):
    """A glTF-friendly material: the image on the base colour, rough, both sides drawn."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.92
    bsdf.inputs["Metallic"].default_value = 0.0
    if image is not None:
        image.scale(*size)
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        mat.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.03, 0.035, 0.04, 1)
    return mat


def shade_inside(mesh):
    """Vertex colours darkening the bore away from the portal (the city's sun lights it inside)."""
    colours = mesh.color_attributes.new("Col", "BYTE_COLOR", "POINT")
    for vertex, colour in zip(mesh.vertices, colours.data, strict=True):
        t = min(1.0, max(0.0, (vertex.co.y - INSIDE[0]) / (INSIDE[1] - INSIDE[0])))
        shade = 1 - (1 - DARK) * t * t * (3 - 2 * t)
        colour.color = (shade, shade, shade, 1)


def baked(obj):
    """The object's mesh in world space, its own copy."""
    mesh = obj.data.copy()
    mesh.transform(obj.matrix_world)
    return mesh


def bisect(bm, point, normal, keep_inner):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(
        bm,
        geom=geom,
        plane_co=point,
        plane_no=normal,
        clear_outer=keep_inner,
        clear_inner=not keep_inner,
    )


def main():
    source, target = args()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    stone_image = bpy.data.images["Stone.jpg"]
    concrete_image = bpy.data.images["crop_concrete-019.jpg"]
    materials = {
        "stone": material("portal-stone", stone_image, (512, 341)),
        "concrete": material("portal-concrete", concrete_image, (512, 512)),
        "dark": material("portal-dark", None, None),
    }
    parts = []
    for name, kind in KEEP.items():
        bm = bmesh.new()
        bm.from_mesh(baked(bpy.data.objects[name]))
        if name in MIRRORED:
            # The left half round the bore, then its mirror image joined on the bore's axis.
            bisect(bm, Vector((CENTRE_X, 0, 0)), Vector((1, 0, 0)), keep_inner=True)
            mirror = bm.copy()
            bmesh.ops.transform(
                mirror,
                matrix=Matrix.Translation((CENTRE_X, 0, 0))
                @ Matrix.Scale(-1, 4, (1, 0, 0))
                @ Matrix.Translation((-CENTRE_X, 0, 0)),
                verts=mirror.verts,
            )
            bmesh.ops.reverse_faces(mirror, faces=mirror.faces)
            other = bpy.data.meshes.new("mirror")
            mirror.to_mesh(other)
            mirror.free()
            bm.from_mesh(other)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
        # The bore and the walkways inside end DEPTH units in.
        bisect(bm, Vector((0, DEPTH, 0)), Vector((0, 1, 0)), keep_inner=True)
        mesh = bpy.data.meshes.new(f"portal-{name}")
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.clear()
        mesh.materials.append(materials[kind])
        if kind == "concrete":
            shade_inside(mesh)
        parts.append(mesh)
    # The dark cap closing the bore where it was cut.
    cap = bpy.data.meshes.new("portal-cap")
    bm = bmesh.new()
    # A disc inside the bore's wall (its outer surface reaches 6.35 across, 5.9 up from its axis).
    ring = [
        (CENTRE_X + 5.8 * math.cos(a), DEPTH - 0.05, CAP_AXIS + 5.6 * math.sin(a))
        for a in (k * math.tau / 24 for k in range(24))
    ]
    bm.faces.new([bm.verts.new(c) for c in ring])
    bm.to_mesh(cap)
    bm.free()
    cap.materials.append(materials["dark"])
    parts.append(cap)

    # Only the new parts stay in the scene.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.name = "railway-portal"
    # Into the station's frame: origin on the track at the rail top in the headwall's plane, the
    # tunnel running away from the station, sized to the city's gauge. Blender's -y is glTF's +z.
    frame = (
        Matrix.Scale(SCALE, 4)
        @ Matrix.Rotation(math.pi, 4, "Z")
        @ Matrix.Translation((-CENTRE_X, 0, -RAIL_TOP))
    )
    objects = []
    for mesh in parts:
        mesh.transform(frame)
        mesh.validate()
        obj = bpy.data.objects.new(mesh.name, mesh)
        scene.collection.objects.link(obj)
        objects.append(obj)
    # One object per material keeps the draw calls at three.
    by_material = {}
    for obj in objects:
        by_material.setdefault(obj.data.materials[0].name, []).append(obj)
    for group in by_material.values():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        group[0].name = group[0].data.materials[0].name
    root = bpy.data.objects.new("railway-portal", None)
    scene.collection.objects.link(root)
    for obj in [o for o in scene.objects if o.type == "MESH"]:
        obj.parent = root
    bpy.ops.object.select_all(action="SELECT")
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=78,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_vertex_color="ACTIVE",
    )
    triangles = 0
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    print(f"wrote {target} ({target.stat().st_size} bytes, {triangles} triangles)")


main()
