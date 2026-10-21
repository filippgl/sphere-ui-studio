import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encode, decode, parse, walk } from './ui-core.mjs';
import { prepareHd, hdAlias, validateHdManifest } from './hd-core.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
function dds(size) {
  const bytes = new Uint8Array(128 + size * size * 4),
    view = new DataView(bytes.buffer);
  bytes.set([68, 68, 83, 32]);
  for (const [offset, value] of [
    [4, 124],
    [8, 0x100f],
    [12, size],
    [16, size],
    [20, size * 4],
    [76, 32],
    [80, 0x41],
    [88, 32],
    [92, 0xff0000],
    [96, 0xff00],
    [100, 0xff],
    [104, 0xff000000],
    [108, 0x1000],
  ])
    view.setUint32(offset, value, true);
  bytes.fill(180, 128);
  return bytes;
}
const source = dds(16),
  output = dds(64),
  compressed = gzipSync(output);
const entry = {
  sourceSha256: hash(source),
  sourceSize: [16, 16],
  size: [64, 64],
  scale: 4,
  kind: 'ui',
  sha256: hash(output),
  file: hash(output) + '.dds.gz',
  bytes: output.length,
  compressedSha256: hash(compressed),
};
const manifest = { version: 1, scale: 4, entries: [entry] };
const text =
  'windowUI\n{\n windowName "sample"\n size 24 24\n sprite\n {\n texture "native" 0 0 16 16 0 0 24 24\n tcoords 0 0 0 0 16 16 16 16 0\n }\n}\n';
const fixture = () => {
  const store = new Map([['textures/native.dds', source]]);
  const changes = [{ name: 'sample.ui', before: encode(text), after: encode(text) }];
  const request = {
    file: 'sample.ui',
    node: walk(parse(text)).find((n) => n.kind === 'windowUI').id,
  };
  const options = {
    changes,
    requests: [request],
    read: async (s, n) => store.get(s + '/' + n) || null,
    load: async (name) =>
      name === 'manifest.json' ? new TextEncoder().encode(JSON.stringify(manifest)) : compressed,
  };
  return { store, changes, options };
};
test('HD rewrites UVs and rotated coordinates once, retaining destination geometry', async () => {
  const { store, changes, options } = fixture();
  const first = await prepareHd(options),
    alias = hdAlias(entry);
  assert.match(decode(changes[0].after), new RegExp('"' + alias + '" 0 0 64 64 0 0 24 24'));
  assert.match(decode(changes[0].after), /tcoords 0 0 0 0 64 64 64 64 0/);
  assert.equal(first.assets.length, 1);
  assert.deepEqual(first.assets[0].after, output);
  store.set('xadd/' + alias + '.dds', output);
  const saved = changes[0].after.slice();
  const second = await prepareHd(options);
  assert.equal(second.assets.length, 0);
  assert.deepEqual(changes[0].after, saved);
});
test('HD matches original bytes, rejects corrupt downloads, and leaves custom textures intact', async () => {
  const unknown = fixture();
  unknown.store.set('textures/native.dds', dds(8));
  const result = await prepareHd(unknown.options);
  assert.equal(result.assets.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(decode(unknown.changes[0].after), text);
  const broken = fixture();
  broken.options.load = async (name) =>
    name === 'manifest.json'
      ? new TextEncoder().encode(JSON.stringify(manifest))
      : new Uint8Array([1, 2, 3]);
  await assert.rejects(prepareHd(broken.options), /Повреждена загрузка/);
  assert.throws(() =>
    validateHdManifest({ ...manifest, entries: [{ ...entry, file: '../anything' }] }),
  );
});
test('HD upgrades new scaled font atlases while preserving their filenames and SFNT assets', async () => {
  const fontEntry = { ...entry, kind: 'font' },
    fontManifest = { ...manifest, entries: [fontEntry] };
  const sfn = { scope: 'effects', name: 'studio_f2_1500.sfn', after: new Uint8Array([1, 2, 3]) };
  const font = { scope: 'xadd', name: 'studio_f2_1500.dds', after: source };
  await prepareHd({
    changes: [],
    fontAssets: [sfn, font],
    read: async () => null,
    load: async (name) =>
      name === 'manifest.json'
        ? new TextEncoder().encode(JSON.stringify(fontManifest))
        : compressed,
  });
  assert.equal(font.name, 'studio_f2_1500.dds');
  assert.deepEqual(font.after, output);
  assert.deepEqual(sfn.after, new Uint8Array([1, 2, 3]));
});

test('HD upgrades an existing scaled font without changing its ID and skips an installed upgrade', async () => {
  const fontManifest = { ...manifest, entries: [{ ...entry, kind: 'font' }] };
  const content = encode('windowUI\n{\n windowName "test"\n size 24 24\n font 4\n}\n');
  const node = walk(parse(decode(content))).find((n) => n.kind === 'windowUI');
  const store = new Map([['xadd/studio_f2_1500.dds', source]]);
  const changes = [{ name: 'sample.ui', before: content, after: content }];
  const options = {
    changes,
    definitions: [{ id: 4, asset: 'studio_f2_1500' }],
    requests: [{ file: 'sample.ui', node: node.id }],
    read: async (scope, name) => store.get(scope + '/' + name) || null,
    load: async (name) =>
      name === 'manifest.json'
        ? new TextEncoder().encode(JSON.stringify(fontManifest))
        : compressed,
  };
  const first = await prepareHd(options);
  assert.equal(first.assets.length, 1);
  assert.equal(first.assets[0].hdUpgrade, true);
  assert.equal(first.assets[0].name, 'studio_f2_1500.dds');
  assert.deepEqual(changes[0].after, content);
  store.set('xadd/studio_f2_1500.dds', output);
  assert.equal((await prepareHd(options)).assets.length, 0);
});
