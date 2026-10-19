import fs from 'node:fs/promises';
import path from 'node:path';
import { decode, parse, walk, value, unquote, hash } from './ui-model.mjs';

const client = process.argv[2] || process.env.SPHERE_CLIENT;
if (!client)
  throw Error(
    'Укажите папку клиента: node generate-catalog.mjs <client> [current-mbc] [legacy-decompiler]',
  );
const current = process.argv[3];
const old = process.argv[4];
const files = [];
const openSites = new Map(),
  controlSites = new Map();
for (const module of (await fs.readdir(path.join(client, 'mbc'))).filter((n) =>
  n.endsWith('.mbc'),
)) {
  const currentHash = hash(await fs.readFile(path.join(client, 'mbc', module)));
  let text, source;
  try {
    const manifest = current
      ? JSON.parse(await fs.readFile(path.join(current, 'manifest.json'), 'utf8'))
      : [];
    if (manifest.find((m) => m.module === path.parse(module).name)?.sha256 === currentHash) {
      source = path.join(current, path.parse(module).name + '.txt');
      text = await fs.readFile(source, 'utf8');
    } else if (old && hash(await fs.readFile(path.join(old, 'mbc', module))) === currentHash) {
      source = path.join(old, 'decompile_result', path.parse(module).name + '.txt');
      text = await fs.readFile(source, 'utf8');
    }
  } catch {
    continue;
  }
  if (!text) continue;
  const lines = text.split('\n'),
    handles = new Map();
  let fn = '';
  lines.forEach((line, i) => {
    const f = line.match(/^function (\w+)/);
    if (f) fn = f[1];
    const m = line.match(/auto (\w+) = window\.open\("([^"]+)", (.*)\);/);
    if (!m) return;
    const name = m[2],
      site = { module, function: fn, line: i + 1, arguments: m[3], source, sha256: currentHash };
    if (!openSites.has(name)) openSites.set(name, []);
    openSites.get(name).push(site);
    for (const later of lines.slice(i + 1, i + 4)) {
      const assign = later.match(new RegExp('(g_\\w+) = ' + m[1] + ';'));
      if (assign) handles.set(assign[1], name);
    }
  });
  fn = '';
  lines.forEach((line, i) => {
    const f = line.match(/^function (\w+)/);
    if (f) fn = f[1];
    const m = line.match(/window\.control_at\((\w+), (.*?)\);/);
    if (!m || !handles.has(m[1])) return;
    const name = handles.get(m[1]);
    if (!controlSites.has(name)) controlSites.set(name, []);
    controlSites.get(name).push({ module, function: fn, line: i + 1, control: m[2], source });
  });
}
for (const name of (await fs.readdir(path.join(client, 'effects'))).filter((n) =>
  n.endsWith('.ui'),
)) {
  const bytes = await fs.readFile(path.join(client, 'effects', name));
  const tree = parse(decode(bytes));
  const windows = walk(tree)
    .filter((n) => n.kind === 'windowUI')
    .map((n) => {
      const windowName = unquote(value(n, 'windowName'));
      return {
        name: windowName,
        properties: n.props,
        openSites: openSites.get(windowName) || [],
        controlSites: controlSites.get(windowName) || [],
        controls: n.children
          .filter((c) => c.kind === 'control')
          .map((c, i) => ({ id: i + 1, class: value(c, 'classID'), properties: c.props })),
        sprites: walk(n)
          .filter((c) => c.kind === 'sprite')
          .map((c) => ({ name: unquote(value(c, 'name')), properties: c.props })),
      };
    });
  files.push({ file: name, sha256: hash(bytes), windows });
}
const result = { client, date: new Date().toISOString().slice(0, 10), files };
await fs.writeFile(new URL('./catalog.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(
  `${files.length} files; ${files.flatMap((f) => f.windows).length} windows; ${[...openSites.values()].flat().length} verified opening sites`,
);
