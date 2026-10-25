// Build a self-contained static bundle with the exact runtime locked by npm ci.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/web');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const three = JSON.parse(await readFile(path.join(root, 'node_modules/three/package.json'), 'utf8'));
if (three.version !== pkg.dependencies.three) throw new Error('Run npm ci before building: three.js version differs from package.json.');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'src', 'styles', 'assets']) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}
for (const entry of ['build', 'examples/jsm']) {
  await cp(path.join(root, 'node_modules/three', entry), path.join(output, 'node_modules/three', entry), { recursive: true });
}
await cp(path.join(root, 'node_modules/three/LICENSE'), path.join(output, 'node_modules/three/LICENSE'));
// Jekyll otherwise excludes node_modules and prevents the import map from loading three.js.
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(path.join(output, 'version.json'), JSON.stringify({ version: pkg.version, commit: process.env.GITHUB_SHA || null }, null, 2) + '\n');
console.log('Static web bundle created in dist/web. Relative module URLs also work under /fly/.');
