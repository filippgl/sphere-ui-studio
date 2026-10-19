import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, 'dist');
const files = [
  'index.html',
  'style.css',
  'app.mjs',
  'storage.mjs',
  'browser-storage.mjs',
  'browser-files.mjs',
  'ui-core.mjs',
  'dds-core.mjs',
  'zip.mjs',
  'WINDOWS.md',
];
await fs.mkdir(output, { recursive: true });
const allowed = new Set([...files, 'runtime.mjs', 'version.json']);
for (const name of await fs.readdir(output))
  if (!allowed.has(name)) throw Error('В dist есть посторонний файл: ' + name);
for (const name of files) await fs.copyFile(path.join(here, name), path.join(output, name));
let commit = 'unversioned';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: here,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
} catch {}
await fs.writeFile(
  path.join(output, 'runtime.mjs'),
  `export default ${JSON.stringify({ mode: 'browser', version: commit })};\n`,
);
const hashes = {};
for (const name of [...files, 'runtime.mjs'])
  hashes[name] = createHash('sha256')
    .update(await fs.readFile(path.join(output, name)))
    .digest('hex');
await fs.writeFile(
  path.join(output, 'version.json'),
  JSON.stringify({ commit, files: hashes }, null, 2),
);
console.log(`Browser build: ${output}; ${files.length + 2} static files`);
