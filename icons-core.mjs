import { rgbaFromDds } from './dds-core.mjs';

// Slots draw an item picture at min(picture size, slot size), so larger slots never enlarge the
// 32x32 textures\*.dds icons. The editor writes enlarged copies and keeps the originals here.
export const iconStore = '_interface-editor-icons';
const manifestName = 'manifest.json';
export const iconSize = (scale) => Math.round(32 * scale);

// Textures cut by pixel coordinates in .ui sprites keep their size.
export function spriteTextures(uiTexts) {
  const names = new Set();
  for (const text of uiTexts)
    for (const m of text.matchAll(/^[ \t]*texture[ \t]+"([^"]+)"/gim))
      names.add(m[1].toLowerCase());
  return names;
}
function ddsSize(bytes) {
  if (bytes.length < 128 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'DDS ') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16, true), view.getUint32(12, true)];
}
export const isIcon = (bytes) => ddsSize(bytes)?.join('x') === '32x32';

// Catmull-Rom resampling on premultiplied alpha keeps edges crisp without dark fringes.
function resample({ width, height, data }, size) {
  const out = new Uint8Array(size * size * 4),
    weight = (t) => {
      t = Math.abs(t);
      return t < 1
        ? 1.5 * t ** 3 - 2.5 * t ** 2 + 1
        : t < 2
          ? -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2
          : 0;
    },
    at = (x, y, c) => {
      x = Math.min(width - 1, Math.max(0, x));
      y = Math.min(height - 1, Math.max(0, y));
      const p = (y * width + x) * 4,
        a = data[p + 3] / 255;
      return c === 3 ? data[p + 3] : data[p + c] * a;
    };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = ((x + 0.5) * width) / size - 0.5,
        sy = ((y + 0.5) * height) / size - 0.5,
        ix = Math.floor(sx),
        iy = Math.floor(sy),
        sum = [0, 0, 0, 0];
      for (let j = -1; j <= 2; j++)
        for (let i = -1; i <= 2; i++) {
          const w = weight(sx - (ix + i)) * weight(sy - (iy + j));
          for (let c = 0; c < 4; c++) sum[c] += w * at(ix + i, iy + j, c);
        }
      const alpha = Math.min(255, Math.max(0, sum[3])),
        p = (y * size + x) * 4;
      for (let c = 0; c < 3; c++)
        out[p + c] = alpha ? Math.min(255, Math.max(0, Math.round((sum[c] * 255) / alpha))) : 0;
      out[p + 3] = Math.round(alpha);
    }
  return out;
}
// Uncompressed 32-bit DDS like the client's own icons (A8R8G8B8, no mipmaps).
export function scaleIcon(bytes, size) {
  const rgba = resample(rgbaFromDds(bytes), size),
    out = new Uint8Array(128 + size * size * 4),
    view = new DataView(out.buffer);
  out.set([0x44, 0x44, 0x53, 0x20]);
  for (const [offset, value] of [
    [4, 124],
    [8, 0x100f],
    [12, size],
    [16, size],
    [20, size * 4],
    [76, 32],
    [80, 0x41],
    [88, 32],
    [92, 0x00ff0000],
    [96, 0x0000ff00],
    [100, 0x000000ff],
    [104, 0xff000000],
    [108, 0x1000],
  ])
    view.setUint32(offset, value, true);
  for (let i = 0; i < size * size; i++) {
    const p = i * 4;
    out.set([rgba[p + 2], rgba[p + 1], rgba[p], rgba[p + 3]], 128 + p);
  }
  return out;
}

const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2));
// Scale written by the last save; 1 when icons were never enlarged.
export async function currentIconScale(read) {
  const manifest = await read(iconStore, manifestName);
  return manifest ? json(manifest).scale : 1;
}
// io: read(scope, name) -> bytes | null, list(scope) -> file names, uiTexts -> .ui sources.
export async function prepareIcons(scale, io) {
  if (!(scale >= 1 && scale <= 3)) throw Error('Масштаб иконок: от 100% до 300%');
  const manifest = await io.read(iconStore, manifestName),
    known = manifest ? json(manifest).names : null,
    skip = spriteTextures(io.uiTexts),
    assets = [];
  let names = known;
  if (!names) {
    names = [];
    for (const file of await io.list('textures')) {
      const name = file.toLowerCase();
      if (!name.endsWith('.dds') || skip.has(name.slice(0, -4))) continue;
      const bytes = await io.read('textures', file);
      if (bytes && isIcon(bytes)) {
        names.push(file);
        // The first enlargement keeps the untouched pictures for later scales and for 100%.
        assets.push({ scope: iconStore, name: file, after: bytes });
      }
    }
    if (scale === 1) return { assets: [] };
  }
  for (const name of names) {
    const original = known ? await io.read(iconStore, name) : null,
      source = original || assets.find((a) => a.name === name)?.after;
    if (!source) continue;
    assets.push({
      scope: 'textures',
      name,
      after: scale === 1 ? source : scaleIcon(source, iconSize(scale)),
    });
  }
  assets.push({ scope: iconStore, name: manifestName, after: jsonBytes({ scale, names }) });
  return { assets };
}
