"""Trim official CC0 Quaternius glTF files to Idle/Wave and pack self-contained GLBs.

Usage: python scripts/prepare_city_characters.py male.gltf female.gltf
Source URLs and licenses are recorded beside the output models.
"""

import base64
import json
import struct
import sys
from pathlib import Path


def convert(source, destination):
    data = json.loads(Path(source).read_text(encoding="utf-8"))
    data["animations"] = [a for a in data["animations"] if a["name"] in {"Idle_Neutral", "Wave"}]
    used = set()
    for mesh in data["meshes"]:
        for primitive in mesh["primitives"]:
            used.update(primitive["attributes"].values())
            if "indices" in primitive:
                used.add(primitive["indices"])
    for skin in data["skins"]:
        used.add(skin["inverseBindMatrices"])
    for animation in data["animations"]:
        for sampler in animation["samplers"]:
            used.update([sampler["input"], sampler["output"]])
    remap = {old: new for new, old in enumerate(sorted(used))}
    accessors = [data["accessors"][old] for old in sorted(used)]
    views = sorted({a["bufferView"] for a in accessors})
    view_map = {old: new for new, old in enumerate(views)}
    buffers = [base64.b64decode(b["uri"].split(",", 1)[1]) for b in data["buffers"]]
    binary = bytearray()
    packed = []
    for index in views:
        view = dict(data["bufferViews"][index])
        offset = view.get("byteOffset", 0)
        payload = buffers[view["buffer"]][offset : offset + view["byteLength"]]
        binary.extend(b"\0" * (-len(binary) % 4))
        view.update(buffer=0, byteOffset=len(binary))
        binary.extend(payload)
        packed.append(view)
    for accessor in accessors:
        accessor["bufferView"] = view_map[accessor["bufferView"]]
    for mesh in data["meshes"]:
        for primitive in mesh["primitives"]:
            primitive["attributes"] = {k: remap[v] for k, v in primitive["attributes"].items()}
            if "indices" in primitive:
                primitive["indices"] = remap[primitive["indices"]]
    for skin in data["skins"]:
        skin["inverseBindMatrices"] = remap[skin["inverseBindMatrices"]]
    for animation in data["animations"]:
        for sampler in animation["samplers"]:
            sampler["input"], sampler["output"] = remap[sampler["input"]], remap[sampler["output"]]
    data.update(accessors=accessors, bufferViews=packed, buffers=[{"byteLength": len(binary)}])
    metadata = json.dumps(data, separators=(",", ":")).encode()
    metadata += b" " * (-len(metadata) % 4)
    binary += b"\0" * (-len(binary) % 4)
    glb = struct.pack("<4sII", b"glTF", 2, 28 + len(metadata) + len(binary))
    glb += struct.pack("<I4s", len(metadata), b"JSON") + metadata
    glb += struct.pack("<I4s", len(binary), b"BIN\0") + binary
    destination.write_bytes(glb)
    print(destination.name, len(glb), "bytes")


if __name__ == "__main__":
    output = Path(__file__).resolve().parents[1] / "frontend/src/pages/city/models"
    for gender, source in zip(("male", "female"), sys.argv[1:], strict=True):
        convert(source, output / f"operator-{gender}.glb")
