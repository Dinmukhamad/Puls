import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decorative gold is allowed on icons and surfaces; text needs the themed gold-text token.
export function coinTextViolations(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const violations = [];
  const declarations = /(?:^|[;{])\s*color\s*:\s*([^;}]+)/g;
  for (const match of withoutComments.matchAll(declarations)) {
    if (/var\(\s*--coin-color\b/.test(match[1])) {
      violations.push({ line: withoutComments.slice(0, match.index).split('\n').length, value: match[1].trim() });
    }
  }
  return violations;
}

async function checkDirectory(directory) {
  let failures = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) failures += await checkDirectory(path);
    else if (entry.name.endsWith('.css')) {
      for (const violation of coinTextViolations(await readFile(path, 'utf8'))) {
        process.stderr.write(`${path}:${violation.line}: decorative --coin-color in text; use --gold-text\n`);
        failures += 1;
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await checkDirectory(fileURLToPath(new URL('../src/', import.meta.url)));
  if (failures) process.exitCode = 1;
  else process.stdout.write('Coin text contrast token check passed.\n');
}
