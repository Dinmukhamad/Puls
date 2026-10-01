/**
 * Writes the plots of the team districts for the server (app/data/city_land.json) from the client's land grid
 * (src/city3d/world/land.ts), the cities opened as the app opens them (world/cities.ts, world/sales.ts), so both
 * sell the same plots. Run it after changing the land, the streets or the station: `node scripts/city-land.mjs`;
 * src/city3d/world/land.test.mjs fails while the file is stale.
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LAND_FILE = fileURLToPath(new URL('../../app/data/city_land.json', import.meta.url));

/** The file's text: one block a line, so a change of the land reads as a change of its blocks. */
export async function cityLandText() {
  const built = await build({
    stdin: { contents: `export { islandWorld } from './cities.ts'; export { generateSalesWorld } from './sales.ts'; export { landGrid, landJson, PLOT } from './land.ts'; export { WORLD_X4 } from './worldSpec.ts';`, resolveDir: fileURLToPath(new URL('../src/city3d/world/', import.meta.url)), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const L = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const cities = { support: L.landJson(L.landGrid(L.islandWorld(L.WORLD_X4))), sales: L.landJson(L.landGrid(L.generateSalesWorld())) };
  const lines = ['{', `  "plot": ${L.PLOT},`, '  "cities": {'];
  Object.entries(cities).forEach(([city, land], i, all) => {
    lines.push(`    "${city}": {`, `      "bands": ${land.bands},`, '      "districts": {');
    Object.entries(land.districts).forEach(([district, blocks], j, districts) => {
      lines.push(`        "${district}": [`);
      blocks.forEach((b, k) => lines.push(`          ${JSON.stringify(b).replaceAll(',"', ', "').replaceAll('":', '": ')}${k + 1 < blocks.length ? ',' : ''}`));
      lines.push(`        ]${j + 1 < districts.length ? ',' : ''}`);
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
