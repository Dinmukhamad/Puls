import { Mesh, Texture, type Object3D, type Material, type BufferGeometry } from "three/webgpu";

/** Also handles resources from GLBs that finish loading after the viewer was unmounted. */
export function disposeTree(root: Object3D) {
  const geometry = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometry.add(object.geometry);
    for (const material of [object.material].flat()) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
    if ("dispose" in object && typeof object.dispose === "function") object.dispose();
  });
  textures.forEach(texture => {
    const source = texture.source?.data;
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
    texture.dispose();
  });
  geometry.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
}
