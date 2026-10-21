import { decode, encode, parse, walk, applyEdits } from './ui-core.mjs';

export const hdAlias = (entry) => 'studio_h4_' + entry.sha256.slice(0, 20);
export const isHdAlias = (name) => /^studio_h4_[a-f0-9]{20}$/i.test(name);
const sha = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
const bytesJson = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

export function validateHdManifest(manifest) {
  if (manifest?.version !== 1 || manifest.scale !== 4 || !Array.isArray(manifest.entries))
    throw Error('Некорректный пакет HD-текстур');
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (
      !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !/^[a-f0-9]{64}$/.test(entry.compressedSha256) ||
      entry.file !== entry.sha256 + '.dds.gz' ||
      entry.scale !== 4 ||
      !['ui', 'font'].includes(entry.kind) ||
      !Array.isArray(entry.sourceSize) ||
      entry.sourceSize.length !== 2 ||
      !Array.isArray(entry.size) ||
      entry.size.length !== 2 ||
      entry.sourceSize.some(
        (v, i) => !Number.isInteger(v) || v < 1 || v > 1024 || entry.size[i] !== v * 4,
      ) ||
      entry.bytes !== 128 + entry.size[0] * entry.size[1] * 4 ||
      seen.has(entry.sourceSha256)
    )
      throw Error('Повреждён манифест HD-текстур');
    seen.add(entry.sourceSha256);
  }
  return manifest;
}

// io.read(scope,name) reads only the selected client; io.load(name) reads the bundled pack.
// Changes and fontAssets belong to the caller's existing save transaction, including backups.
export async function prepareHd({
  changes,
  fontAssets = [],
  definitions = [],
  requests = [],
  read,
  load,
}) {
  if (!Array.isArray(requests) || requests.length > 256) throw Error('Некорректный список окон HD');
  const fontCandidates = fontAssets.filter(
    (a) => a.scope === 'xadd' && Number(a.name.match(/^studio_f\d+_(\d+)/)?.[1]) > 1000,
  );
  if (!requests.length && !fontCandidates.length) return { assets: [], warnings: [], count: 0 };
  const manifest = validateHdManifest(bytesJson(await load('manifest.json')));
  const bySource = new Map(manifest.entries.map((e) => [e.sourceSha256, e]));
  const byAlias = new Map(manifest.entries.map((e) => [hdAlias(e), e]));
  const assets = new Map(),
    loaded = new Map(),
    missing = new Set(),
    fontIds = new Set(),
    resolved = new Map();
  let upgradedFonts = 0,
    addedShared;
  const packed = async (entry) => {
    if (!loaded.has(entry.sha256))
      loaded.set(
        entry.sha256,
        (async () => {
          const compressed = await load(entry.file);
          if (entry.compressedSha256 && (await sha(compressed)) !== entry.compressedSha256)
            throw Error('Повреждена загрузка HD-текстуры');
          const stream = new Blob([compressed])
            .stream()
            .pipeThrough(new DecompressionStream('gzip'));
          const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          if (
            bytes.length !== entry.bytes ||
            (await sha(bytes)) !== entry.sha256 ||
            String.fromCharCode(...bytes.slice(0, 4)) !== 'DDS ' ||
            view.getUint32(16, true) !== entry.size[0] ||
            view.getUint32(12, true) !== entry.size[1]
          )
            throw Error('HD-текстура не совпадает с проверенным пакетом');
          return bytes;
        })(),
      );
    return loaded.get(entry.sha256);
  };
  const texture = async (name) => {
    for (const scope of ['textures/fx', 'xadd', 'textures']) {
      const bytes = await read(scope, name + '.dds');
      if (bytes) return bytes;
    }
    return null;
  };
  const ensure = async (entry) => {
    const name = hdAlias(entry) + '.dds';
    if (assets.has(name)) return;
    const before = await read('xadd', name);
    if (before && (await sha(before)) !== entry.sha256) throw Error('Конфликт HD-текстуры ' + name);
    if (!before) assets.set(name, { scope: 'xadd', name, after: await packed(entry) });
  };
  const resolve = async (name) => {
    if (byAlias.has(name)) return { entry: byAlias.get(name), changed: false };
    if (isHdAlias(name)) throw Error('Эта HD-текстура отсутствует в установленном пакете');
    if (!resolved.has(name))
      resolved.set(
        name,
        (async () => {
          const bytes = await texture(name);
          const entry = bytes && bySource.get(await sha(bytes));
          if (!entry || entry.kind !== 'ui') {
            missing.add(name);
            return null;
          }
          return { entry, changed: true };
        })(),
      );
    return resolved.get(name);
  };
  const planned = new Map();
  for (const request of requests) {
    if (!request || typeof request.file !== 'string' || typeof request.node !== 'string')
      throw Error('Некорректное окно HD');
    const change = changes.find((c) => !c.scope && c.name === request.file);
    if (!change) throw Error('Окно HD должно входить в это сохранение');
    const model = parse(decode(change.after));
    const node = walk(model).find((n) => n.id === request.node && n.kind === 'windowUI');
    if (!node) throw Error('Не найдено окно для HD-текстур');
    if (!planned.has(change.name)) planned.set(change.name, { change, model, nodes: new Map() });
    for (const n of walk(node)) planned.get(change.name).nodes.set(n.id, n);
  }
  if (requests.length) {
    let shared = changes.find((c) => !c.scope && c.name.toLowerCase() === 'sprites.ui');
    if (!shared) {
      const before = await read('effects', 'sprites.ui');
      if (before) {
        shared = { name: 'sprites.ui', before, after: before };
        changes.push(shared);
        addedShared = shared;
      }
    }
    if (shared) {
      const model = parse(decode(shared.after));
      planned.set(shared.name, {
        change: shared,
        model,
        nodes: new Map(walk(model).map((n) => [n.id, n])),
      });
    }
  }
  for (const { change, nodes } of planned.values()) {
    const edits = new Map();
    const put = (p, value) =>
      edits.set(p.start + ':' + p.end, { start: p.start, end: p.end, value });
    for (const node of nodes.values()) {
      const textures = node.props.filter((p) => p.key.toLowerCase() === 'texture');
      for (const p of node.props.filter((p) => p.key.toLowerCase() === 'font'))
        fontIds.add(Number(p.value));
      for (let index = 0; index < textures.length; index++) {
        const p = textures[index],
          tokens = p.value.match(/"[^"]*"|\S+/g);
        if (tokens?.length !== 9) continue;
        const name = tokens[0].slice(1, -1).toLowerCase();
        const result = await resolve(name);
        if (!result) continue;
        await ensure(result.entry);
        if (!result.changed) continue;
        put(
          p,
          [
            '"' + hdAlias(result.entry) + '"',
            ...tokens.slice(1, 5).map((v) => Number(v) * 4),
            ...tokens.slice(5),
          ].join(' '),
        );
        for (const coord of node.props.filter((p) => p.key.toLowerCase() === 'tcoords')) {
          const values = coord.value.split(/\s+/).map(Number);
          if (values[0] === index)
            put(coord, [index, ...values.slice(1).map((v) => v * 4)].join(' '));
        }
      }
    }
    if (edits.size) change.after = encode(applyEdits(decode(change.after), [...edits.values()]));
  }
  // New scaled font metrics retain normalized UVs, so only their DDS needs replacement.
  for (const asset of fontCandidates) {
    const entry = bySource.get(await sha(asset.after));
    if (entry?.kind === 'font') {
      asset.after = await packed(entry);
      upgradedFonts++;
    } else missing.add(asset.name);
  }
  for (const id of fontIds) {
    const definition = definitions.find((f) => f.id === id);
    const name = definition?.asset;
    if (!name || !/^studio_f\d+_\d+$/.test(name) || Number(name.match(/_(\d+)$/)[1]) <= 1000)
      continue;
    for (const suffix of ['', '_d', '_f', '_i', '_p', '_spa']) {
      const file = name + suffix + '.dds';
      if (fontAssets.some((a) => a.scope === 'xadd' && a.name === file)) continue;
      const before = await read('xadd', file);
      if (!before) continue;
      const digest = await sha(before);
      if (manifest.entries.some((e) => e.sha256 === digest)) continue;
      const entry = bySource.get(digest);
      if (entry?.kind === 'font')
        assets.set(file, {
          scope: 'xadd',
          name: file,
          after: await packed(entry),
          hdUpgrade: true,
        });
    }
  }
  if (addedShared && addedShared.after === addedShared.before)
    changes.splice(changes.indexOf(addedShared), 1);
  return {
    assets: [...assets.values()],
    count: assets.size + upgradedFonts,
    warnings: missing.size
      ? ['Нет совместимой HD-версии для: ' + [...missing].slice(0, 8).join(', ')]
      : [],
  };
}
