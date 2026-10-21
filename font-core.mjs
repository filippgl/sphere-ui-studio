import { decode, encode } from './ui-core.mjs';

export function fontDefinitions(cfg) {
  return [...cfg.matchAll(/^\s*NEW_FONT_(\d+)\s+"([\w-]+)"[^\r\n]*?(?:\/\/\s*([^\r\n]+))?$/gm)].map(
    (m) => ({
      id: Number(m[1]) + 2,
      asset: m[2],
      name: m[3]?.trim() || m[2],
    }),
  );
}
export function readSfn(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'SFNT')
    throw Error('Неизвестный формат шрифта SFNT');
  let start = 4;
  for (let i = 0; i < 2; i++) {
    const end = bytes.indexOf(0, start);
    if (end < start || end - start > 255) throw Error('Повреждён заголовок шрифта');
    start = end + 1;
  }
  if (bytes.length !== start + 8 + 224 * 28) throw Error('Неизвестная структура SFNT');
  return {
    data,
    start,
    height: data.getInt32(start, true),
    baseline: data.getInt32(start + 4, true),
  };
}
export function scaleSfn(bytes, factor) {
  if (!Number.isFinite(factor) || factor < 0.5 || factor > 4)
    throw Error('Масштаб шрифта: от 50% до 400%');
  const result = new Uint8Array(bytes),
    { data, start } = readSfn(result);
  for (const offset of [start, start + 4])
    data.setInt32(offset, Math.round(data.getInt32(offset, true) * factor), true);
  for (let glyph = 0; glyph < 224; glyph++)
    // Width, height, bearings, advance, padding. UV coordinates remain unchanged.
    for (let field = 0; field < 6; field++) {
      const offset = start + 8 + glyph * 28 + field * 2;
      data.setInt16(offset, Math.round(data.getInt16(offset, true) * factor), true);
    }
  return result;
}
export function fontAlias(sourceId, factor) {
  return `studio_f${sourceId}_${Math.round(factor * 1000)}`;
}

// Metrics are derived from the selected client; the HD stage may upgrade compatible atlases.
export async function prepareFonts(requests, cfgBytes, read, list) {
  if (!Array.isArray(requests) || requests.length > 48) throw Error('Некорректный список шрифтов');
  if (!requests.length) return { assets: [], definitions: fontDefinitions(decode(cfgBytes)) };
  let cfg = decode(cfgBytes);
  const definitions = fontDefinitions(cfg),
    assets = [],
    ids = new Set(definitions.map((f) => f.id));
  const effectNames = await list('effects');
  for (const request of requests) {
    const { id, sourceId, factor } = request;
    if (!Number.isInteger(id) || id !== Math.max(1, ...ids) + 1 || id > 63 || ids.has(id))
      throw Error('Перечитайте список шрифтов перед сохранением');
    const source = definitions.find((f) => f.id === sourceId);
    if (!source || source.asset.startsWith('studio_')) throw Error('Не найден исходный шрифт');
    const alias = fontAlias(sourceId, factor);
    if (definitions.some((f) => f.asset === alias))
      throw Error('Этот масштаб шрифта уже существует');
    const variants = effectNames.filter(
      (name) =>
        name.toLowerCase() === `${source.asset}.sfn`.toLowerCase() ||
        new RegExp(`^${source.asset}_(?:d|f|i|p|spa)\\.sfn$`, 'i').test(name),
    );
    if (!variants.some((name) => name.toLowerCase() === `${source.asset}.sfn`.toLowerCase()))
      throw Error(`Нет ${source.asset}.sfn в выбранной копии игры`);
    for (const name of variants) {
      const suffix = name.slice(source.asset.length, -4),
        target = alias + suffix;
      assets.push({
        scope: 'effects',
        name: target + '.sfn',
        after: scaleSfn(await read('effects', name), factor),
      });
      let texture;
      for (const scope of ['xadd', 'textures']) {
        try {
          texture = await read(scope, source.asset + suffix + '.dds');
          break;
        } catch (error) {
          if (error.code !== 'ENOENT' && error.name !== 'NotFoundError') throw error;
        }
      }
      if (!texture) throw Error(`Не найдена текстура ${source.asset + suffix}.dds`);
      assets.push({ scope: 'xadd', name: target + '.dds', after: texture });
    }
    cfg += `\r\nNEW_FONT_${id - 2} "${alias}" // Studio: ${sourceId} x ${factor}`;
    definitions.push({ id, asset: alias, name: `${source.name} × ${factor}`, sourceId, factor });
    ids.add(id);
  }
  const count = Math.max(...ids) - 1;
  if (/^\s*NEW_FONTS_NUMBER\s+\d+/m.test(cfg))
    cfg = cfg.replace(/^(\s*NEW_FONTS_NUMBER\s+)\d+/m, `$1${count}`);
  else cfg = `NEW_FONTS_NUMBER ${count}\r\n` + cfg;
  assets.push({ scope: 'root', name: 'fonts.cfg', after: encode(cfg) });
  return { assets, definitions };
}

export function validAsset(item) {
  return (
    (item.scope === 'root' && ['fonts.cfg', 'config.cfg'].includes(item.name)) ||
    (item.scope === 'mbc' && item.name === 'st_map.mbc') ||
    (item.scope === 'textures' && /^[\w-]+\.dds$/i.test(item.name)) ||
    (item.scope === '_interface-editor-icons' && /^[\w-]+\.(?:dds|json)$/i.test(item.name)) ||
    (item.scope === 'xadd' && /^studio_h4_[a-f0-9]{20}\.dds$/i.test(item.name)) ||
    (['effects', 'xadd'].includes(item.scope) &&
      /^studio_f\d+_\d+(?:_(?:d|f|i|p|spa))?\.(?:sfn|dds)$/i.test(item.name) &&
      item.name.toLowerCase().endsWith(item.scope === 'effects' ? '.sfn' : '.dds'))
  );
}
export const backupFile = (item) => (item.scope ? `${item.scope}--${item.name}` : item.name);
