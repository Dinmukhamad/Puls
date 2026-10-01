"""Turn the CC-BY Blend Swap "Gare de BlenderVille" (#27438, loran17) into the cities' station.

Usage (Blender 4.2 as the `bpy` module or inside Blender):
    python scripts/prepare_railway_station.py Gare_de_BlenderVille.blend railway-station.glb
then pack it with frontend/scripts/pack-city-model.mjs.

The source is a detailed HO-scale station: a main body with two wings and a WC pavilion, every roof
tile and window modelled and subdivided (about 8 million triangles), on its platform with track,
cameras and lights. This keeps the building's outside at the city's distance: the walls, stone
corners and window surrounds, chimneys, the clock and the name boards as they are; doors, windows
and shutters as plain boxes where they stand; the benches by the walls as seat, back and legs; the
tiled roofs as plain slabs with gutters, zinc rake trims and a ridge. Subdivision and bevels are
left off; the interior, track, platform, lamps, posters, plaques, handles, hinges, downpipes and
the bench out past the buffet are dropped. Every material
becomes a plain colour (no textures: some of the source's come from libraries that forbid passing
them on). The name boards get each city's name, in scenes of their own: station-sign-<city>.

The result is in the station's frame (systems/departmentWorld.ts): the origin at the middle of the
building on the ground under its floor slab, +z (glTF) towards the platform side, the WC pavilion
towards +x, LENGTH units long. The license is recorded beside the output model
(LICENSE-railway-station.txt).
"""

import math
import re
import sys
from pathlib import Path

import bpy  # first: the bpy module puts bmesh and mathutils on the path  # isort: skip

import bmesh
from mathutils import Matrix, Vector

#: What stays of the building: everything in these collections but the parts DROP matches.
COLLECTIONS = [
    "Structure",
    "Amenagements_Exterieurs",
    "Buffet",
    "Corps_Principal",
    "Bagagerie",
    "WC",
]
DROP = re.compile(
    r"^(Plancher_|Cloisons_|Quai$|Tuiles_|Gond_|Poignee_|Affiche_|Plaque_|Enseigne_|Lampe_|Embout_"
    r"|Nom_|Dormant_|Goutiere_|Zinc_Pignon_)"
)
#: Parts drawn as their bounding box, in a colour of their own.
BOXED = [
    (re.compile(r"^(Fenetre|Fenestron)"), "station-glass"),
    (re.compile(r"^(Porte|Persienne|Volet)"), "station-green"),
    (re.compile(r"^Pot_Cheminee"), "station-roof"),
]
BENCH = re.compile(r"^Banc_")
#: Source material: (name, colour, roughness, metalness). Unlisted ones belong to dropped parts.
MATERIALS = {
    "Crepi": ("station-wall", "#d6a27a", 0.9, 0.0),
    "Pierre_Encadrement": ("station-stone", "#e8dcc2", 0.9, 0.0),
    "Platre": ("station-plaster", "#ebe6dc", 0.9, 0.0),
    "Carrelage_Sol": ("station-plaster", "#ebe6dc", 0.9, 0.0),
    "Faience_Mur": ("station-plaster", "#ebe6dc", 0.9, 0.0),
    "Beton_Plinthe": ("station-plinth", "#a8a291", 0.9, 0.0),
    "Tuile": ("station-roof", "#9a5b3f", 0.85, 0.0),
    "Zinc": ("station-zinc", "#8d9498", 0.5, 0.4),
    "Peinture_Verte_Porte": ("station-green", "#55703f", 0.6, 0.0),
    "Verre": ("station-glass", "#33505a", 0.25, 0.3),
    "Bleu_Lettrage": ("station-blue", "#1d2a7a", 0.6, 0.0),
    "Blanc_Emaille": ("station-enamel", "#f4efe7", 0.4, 0.0),
    "Cadran_Horloge": ("station-enamel", "#f4efe7", 0.4, 0.0),
    "Plancher_Wagon": ("station-wood", "#8b6a4b", 0.8, 0.0),
    "Laiton Vieilli": ("station-brass", "#b08b5a", 0.4, 0.5),
}
#: The roofs: tiles (their extent once arrayed and mirrored) and the ridge tiles over them.
ROOFS = [
    ("Tuiles_Corps_Principal", "Tuiles_Faitieres_Corps_Principal"),
    ("Tuiles_Corps_Buffet", "Tuiles_Faitieres_Corps_Buffet"),
    ("Tuiles_Corps__Bagagerie", "Tuiles_Faitieres_Corps__Bagagerie"),
    ("Tuiles_WC", "Tuiles_Faitieres_WC"),
]
#: Roof slab thickness, gutter and trim size, and how far the floor stands over the ground.
ROOF_SLAB, TRIM, FLOOR = 0.02, 0.015, 0.09
#: The cities' names on the boards, and how wide they may run on a board (source units).
SIGNS = {"support": "ТЕХПОДДЕРЖКА", "sales": "ОТДЕЛ ПРОДАЖ"}
SIGN_WIDTH, SIGN_LIFT, SIGN_FONT = (
    0.4,
    0.003,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
#: Length of the whole building in the city, WC pavilion included (systems/departmentWorld.ts).
LENGTH = 17.0


def args():
    rest = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(rest) != 2:
        raise SystemExit(__doc__)
    return Path(rest[0]).resolve(), Path(rest[1]).resolve()


def colour(hex_colour):
    """An sRGB hex colour as Blender's linear RGBA."""
    rgb = [int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb] + [1.0]


def plain(name, hex_colour, roughness, metalness):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = colour(hex_colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metalness
    return mat


def kept_objects():
    seen, out = set(), []
    for name in COLLECTIONS:
        for obj in bpy.data.collections[name].all_objects:
            if obj.name in seen or obj.type not in ("MESH", "FONT") or DROP.match(obj.name):
                continue
            seen.add(obj.name)
            out.append(obj)
    return out


def evaluated(obj, depsgraph):
    """The object's mesh in world space without subdivision or bevels."""
    for modifier in list(obj.modifiers):
        if modifier.type in ("SUBSURF", "BEVEL"):
            obj.modifiers.remove(modifier)
    depsgraph.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh.transform(obj.matrix_world)
    return mesh


def bounds(mesh):
    return (
        Vector([min(v.co[i] for v in mesh.vertices) for i in range(3)]),
        Vector([max(v.co[i] for v in mesh.vertices) for i in range(3)]),
    )


def boxes(name, material, *corners):
    """A mesh of boxes, each given by its two opposite corners."""
    bm = bmesh.new()
    for lo, hi in zip(corners[::2], corners[1::2], strict=True):
        made = bmesh.ops.create_cube(bm, size=1.0)
        size = [hi[i] - lo[i] for i in range(3)]
        centre = [(hi[i] + lo[i]) / 2 for i in range(3)]
        bmesh.ops.transform(
            bm, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1)), verts=made["verts"]
        )
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    return mesh


def part(obj, depsgraph, materials):
    """One kept part in plain colours: as it is, as its box, or (a bench) as seat, back and legs."""
    mesh = evaluated(obj, depsgraph)
    for pattern, material in BOXED:
        if pattern.match(obj.name):
            lo, hi = bounds(mesh)
            return boxes(obj.name, materials[material], lo, hi)
    if BENCH.match(obj.name):
        # The back against the wall (the source's -y side), the seat in front of it.
        (x0, y0, z0), (x1, y1, z1) = bounds(mesh)
        seat = z0 + (z1 - z0) * 0.4
        return boxes(
            obj.name,
            materials["station-wood"],
            (x0, y0, seat),
            (x1, y1, seat + 0.012),
            (x0, y0, seat),
            (x1, y0 + 0.012, z1),
            (x0 + 0.01, y0, z0),
            (x0 + 0.025, y1 - 0.01, seat),
            (x1 - 0.025, y0, z0),
            (x1 - 0.01, y1 - 0.01, seat),
        )
    for index, slot in enumerate(mesh.materials):
        target = MATERIALS.get(slot.name if slot else "")
        mesh.materials[index] = materials[target[0] if target else "station-plaster"]
    return mesh


def extent(obj, depsgraph):
    """Bounds of an object with all its modifiers (arrays, mirrors), in world space."""
    mesh = obj.evaluated_get(depsgraph).to_mesh()
    points = [obj.matrix_world @ v.co for v in mesh.vertices]
    obj.evaluated_get(depsgraph).to_mesh_clear()
    return Vector([min(p[i] for p in points) for i in range(3)]), Vector(
        [max(p[i] for p in points) for i in range(3)]
    )


def slope(bm, x0, x1, eave, ridge, lift, thick):
    """A slab along x over a roof slope from (y, z) at the eave to the ridge, `lift` over it."""
    (ya, za), (yb, zb) = eave, ridge
    top = [(x, y, z + lift) for x in (x0, x1) for y, z in ((ya, za + ROOF_SLAB), (yb, zb))]
    v = [bm.verts.new(p) for p in top + [(x, y, z - thick) for x, y, z in top]]
    for face in (
        (0, 1, 3, 2),
        (4, 6, 7, 5),
        (0, 2, 6, 4),
        (1, 5, 7, 3),
        (0, 4, 5, 1),
        (2, 3, 7, 6),
    ):
        bm.faces.new([v[i] for i in face])


def roof(tiles, ridge, depsgraph, materials):
    """A plain gabled roof in place of the tiles: slabs, gutters, zinc rake trims and a ridge."""
    (x0, y0, z0), (x1, y1, _) = extent(tiles, depsgraph)
    (_, ry0, _), (_, ry1, rz1) = extent(ridge, depsgraph)
    yr, made = (ry0 + ry1) / 2, []
    bm = bmesh.new()
    for ye in (y0, y1):
        slope(bm, x0, x1, (ye, z0), (yr, rz1), 0, ROOF_SLAB)
    mesh = bpy.data.meshes.new(f"roof-{tiles.name}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials["station-roof"])
    made.append(mesh)
    bm = bmesh.new()
    for ye in (y0, y1):
        for xa, xb in ((x0 - TRIM, x0 + TRIM / 2), (x1 - TRIM / 2, x1 + TRIM)):
            slope(bm, xa, xb, (ye, z0), (yr, rz1), TRIM / 3, ROOF_SLAB + TRIM)
    mesh = bpy.data.meshes.new(f"trims-{tiles.name}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials["station-zinc"])
    made.append(mesh)
    out = 1 if y1 > y0 else -1
    made.append(
        boxes(
            f"gutters-{tiles.name}",
            materials["station-zinc"],
            (x0, y0 - out * 2 * TRIM, z0 - TRIM),
            (x1, y0, z0 + TRIM / 3),
            (x0, y1, z0 - TRIM),
            (x1, y1 + out * 2 * TRIM, z0 + TRIM / 3),
        )
    )
    made.append(
        boxes(
            f"ridge-{tiles.name}",
            materials["station-roof"],
            (x0, yr - TRIM * 1.3, rz1 - TRIM),
            (x1, yr + TRIM * 1.3, rz1 + TRIM / 2),
        )
    )
    return made


def sign(text, board_text, depsgraph, material):
    """The city's name in place of a board's text: where it was, as wide as the board allows."""
    curve = bpy.data.curves.new(f"sign-{board_text.name}", "FONT")
    curve.body = text
    curve.font = bpy.data.fonts.load(SIGN_FONT, check_existing=True)
    curve.size = board_text.data.size
    curve.align_x, curve.align_y = "CENTER", "CENTER"
    curve.extrude = board_text.data.extrude
    curve.resolution_u = 3
    obj = bpy.data.objects.new(curve.name, curve)
    bpy.context.scene.collection.objects.link(obj)
    depsgraph.update()
    probe = obj.evaluated_get(depsgraph).to_mesh()
    width = max(v.co.x for v in probe.vertices) - min(v.co.x for v in probe.vertices)
    obj.evaluated_get(depsgraph).to_mesh_clear()
    curve.size *= min(1.0, SIGN_WIDTH / width)
    obj.matrix_world = board_text.matrix_world
    depsgraph.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh.transform(obj.matrix_world)
    old = bpy.data.meshes.new_from_object(board_text.evaluated_get(depsgraph))
    old.transform(board_text.matrix_world)
    # Centred where the board's own text was, a hair farther out so it never flickers into it.
    (a0, a1), (b0, b1) = bounds(mesh), bounds(old)
    out = (board_text.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    mesh.transform(Matrix.Translation((b0 + b1) / 2 - (a0 + a1) / 2 + out * SIGN_LIFT))
    mesh.materials.clear()
    mesh.materials.append(material)
    bpy.data.objects.remove(obj, do_unlink=True)
    return mesh


def scene_with(name, meshes, frame, scene=None):
    """A scene (new unless given) with the meshes joined into one object, in the city's frame."""
    scene = scene or bpy.data.scenes.new(name)
    scene.name = name
    objects = []
    for mesh in meshes:
        mesh.transform(frame)
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
    return scene


def main():
    source, target = args()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    materials = {}
    for name, hex_colour, roughness, metalness in MATERIALS.values():
        materials[name] = plain(name, hex_colour, roughness, metalness)
    kept = kept_objects()
    building = [part(obj, depsgraph, materials) for obj in kept if not BENCH.match(obj.name)]
    for tiles, ridge in ROOFS:
        building += roof(bpy.data.objects[tiles], bpy.data.objects[ridge], depsgraph, materials)
    lo = Vector([min(bounds(m)[0][i] for m in building) for i in range(3)])
    hi = Vector([max(bounds(m)[1][i] for m in building) for i in range(3)])
    # The benches along the walls; the one out on the platform past the buffet's end stays behind.
    benches = [part(obj, depsgraph, materials) for obj in kept if BENCH.match(obj.name)]
    building += [b for b in benches if lo.x <= bounds(b)[0].x and bounds(b)[1].x <= hi.x]
    boards = [o for o in bpy.data.objects if o.type == "FONT" and o.name.startswith("Nom_Gare_")]
    signs = {
        city: [sign(text, board, depsgraph, materials["station-blue"]) for board in boards]
        for city, text in SIGNS.items()
    }

    # Into the station's frame: the building's middle on the ground under its floor slab, sized to
    # LENGTH, turned so the platform side (the source's +y) becomes glTF's +z.
    middle, scale = (lo + hi) / 2, LENGTH / (hi.x - lo.x)
    frame = (
        Matrix.Scale(scale, 4)
        @ Matrix.Rotation(math.pi, 4, "Z")
        @ Matrix.Translation((-middle.x, -middle.y, FLOOR - lo.z))
    )
    # Only the new parts are exported: the source's objects go.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scenes = [scene_with("railway-station", building, frame, bpy.context.scene)]
    scenes += [scene_with(f"station-sign-{city}", meshes, frame) for city, meshes in signs.items()]
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
        export_texcoords=False,
    )
    triangles = 0
    for scene in scenes:
        for obj in scene.objects:
            if obj.type == "MESH":
                obj.data.calc_loop_triangles()
                triangles += len(obj.data.loop_triangles)
    size = [round((hi[i] - lo[i]) * scale, 2) for i in range(3)]
    print(f"wrote {target} ({target.stat().st_size} bytes, {triangles} triangles, size {size})")


main()
