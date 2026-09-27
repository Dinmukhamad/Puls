import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CityView } from "../../pages/city/cityScene";

export function createCamera(host: HTMLElement, canvas: HTMLCanvasElement, frame?: HTMLElement) {
  const camera = new PerspectiveCamera(36, 1, .25, 1500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .09;
  controls.minDistance = 24; controls.maxDistance = 240;
  controls.minPolarAngle = .3; controls.maxPolarAngle = 1.3;
  controls.target.set(0, 1, 0);
  const spherical = new Spherical(), offset = new Vector3(), shift = new Vector3();
  const current = (): CityView => {
    spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
    return { distance: spherical.radius, azimuth: spherical.theta, polar: spherical.phi, target: controls.target.toArray() as CityView["target"] };
  };
  function apply(view: CityView) {
    controls.target.fromArray(view.target);
    spherical.set(MathUtils.clamp(view.distance, 24, 240), MathUtils.clamp(view.polar, .3, 1.3), view.azimuth);
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    controls.update();
  }
  function resize() {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    const bounds = host.getBoundingClientRect(), f = frame?.getBoundingClientRect();
    if (f && f.width > 50 && f.height > 50) camera.setViewOffset(width, height, bounds.left + width / 2 - (f.left + f.right) / 2, bounds.top + height / 2 - (f.top + f.bottom) / 2, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function reset() {
    const f = frame?.getBoundingClientRect();
    const height = Math.max(1, host.clientHeight), perPixel = 2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) / height;
    const width = f && f.width > 50 ? f.width : host.clientWidth;
    const freeHeight = f && f.height > 50 ? f.height : height;
    apply({ distance: MathUtils.clamp(Math.max(41 / (perPixel * width), 32 / (perPixel * freeHeight)), 58, 240), azimuth: .68, polar: .85, target: [0, 1, 0] });
  }
  controls.addEventListener("change", () => {
    const length = Math.hypot(controls.target.x, controls.target.z);
    if (length > 12) {
      shift.set(controls.target.x, 0, controls.target.z).multiplyScalar(12 / length - 1);
      controls.target.add(shift); camera.position.add(shift);
    }
    controls.target.y = MathUtils.clamp(controls.target.y, 0, 6);
  });
  return { camera, controls, current, apply, resize, reset };
}
