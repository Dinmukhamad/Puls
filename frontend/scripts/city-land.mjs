/**
 * Writes the cells of the team districts for the server (app/data/city_land.json) from the client's land grid
 * (src/city3d/world/land.ts), the cities opened as the app opens them (world/cities.ts, world/sales.ts), so both
 * sell the same cells. Run it after changing the land, the streets or the station: `node scripts/city-land.mjs`;
 * src/city3d/world/land.test.mjs fails while the file is stale.
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LAND_FILE = fileURLToPath(new URL('../../app/data/city_land.json', import.meta.url));

/** The file's text: one block a line, so a change of the land reads as a change of its blocks. */
export async function cityLandText() {
  const built = await build({
    stdin: { contents: `export { islandWorld } from './cities.ts'; export { generateSalesWorld } from './sales.ts'; export { landGrid, landJson, CELLS, DISTRICT_COUNTS, DEFAULT_DISTRICTS } from './land.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('../src/city3d/world/', import.meta.url)), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const L = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const worlds = { support: L.islandWorld(L.WORLD_X4), sales: L.generateSalesWorld() };
  const lines = ['{', `  "plot_cells": ${L.CELLS},`, '  "cities": {'];
  /** One layout's districts, one block a line, indented by `pad`. */
  const districtLines = (land, pad) => {
    Object.entries(land.districts).forEach(([district, blocks], j, districts) => {
      lines.push(`${pad}"${district}": [`);
      blocks.forEach((b, k) => lines.push(`${pad}  ${JSON.stringify(b).replaceAll(',"', ', "').replaceAll('":', '": ')}${k + 1 < blocks.length ? ',' : ''}`));
      lines.push(`${pad}]${j + 1 < districts.length ? ',' : ''}`);
    });
  };
  Object.entries(worlds).forEach(([city, world], i, all) => {
    // The city's first layout of three districts, then the others it may be cut into.
    const first = L.landJson(L.landGrid(world, L.DEFAULT_DISTRICTS)), others = L.DISTRICT_COUNTS.filter(n => n !== L.DEFAULT_DISTRICTS);
    lines.push(`    "${city}": {`, `      "bands": ${first.bands},`, '      "districts": {');
    districtLines(first, '        ');
    lines.push('      },', '      "layouts": {');
    others.forEach((n, k) => {
      lines.push(`        "${n}": {`);
      districtLines(L.landJson(L.landGrid(world, n)), '          ');
      lines.push(`        }${k + 1 < others.length ? ',' : ''}`);
    });
    lines.push('      }', `    }${i + 1 < all.length ? ',' : ''}`);
  });
  lines.push('  }', '}', '');
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(LAND_FILE, await cityLandText());
  console.log(`Wrote ${LAND_FILE}`);
}
