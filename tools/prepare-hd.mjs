// Export the bundled pack's original atlases from an explicitly selected client.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rgbaFromDds, png } from '../dds.mjs';

const client = process.argv[2];
if (!client) throw Error('Usage: node tools/prepare-hd.mjs <client> [work-directory]');
const work = path.resolve(process.argv[3] || '.run/hd-work');
const manifest = JSON.parse(await fs.readFile(new URL('../hd/manifest.json', import.meta.url)));
const jobs = [],
  directories = new Map();
await fs.mkdir(path.join(work, 'sources'), { recursive: true });
async function locate(scope, name) {
  if (!directories.has(scope))
    directories.set(
      scope,
      await fs.readdir(path.join(client, scope)).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      }),
    );
  const actual = directories.get(scope).find((n) => n.toLowerCase() === name.toLowerCase());
  return actual ? path.resolve(client, scope, actual) : null;
}
for (const entry of manifest.entries)
  for (const name of entry.names) {
    let source;
    for (const scope of ['textures/fx', 'xadd', 'textures']) {
      source = await locate(scope, name + '.dds');
      if (source) break;
    }
    if (!source) throw Error('Missing source DDS: ' + name);
    const bytes = await fs.readFile(source),
      rgba = rgbaFromDds(bytes);
    const file = path.join(work, 'sources', name + '.png');
    await fs.writeFile(file, png(rgba));
    const sfn = entry.kind === 'font' ? await locate('effects', name + '.sfn') : null;
    if (entry.kind === 'font' && !sfn) throw Error('Missing SFNT: ' + name);
    jobs.push({
      name,
      kind: entry.kind,
      source,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      png: file,
      width: rgba.width,
      height: rgba.height,
      sfn,
    });
  }
await fs.writeFile(path.join(work, 'jobs.json'), JSON.stringify(jobs, null, 2));
console.log(`Exported ${jobs.length} atlases to ${work}`);
