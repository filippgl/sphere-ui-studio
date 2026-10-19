import { decode, encode } from './ui-core.mjs';
import mapRecipes from './map-recipe.mjs';
import { prepareIcons } from './icons-core.mjs';

// Game scripts that ignore the .ui files: the chat font comes from config.cfg and the map
// markers from mbc\st_map.mbc. The editor keeps both in step with the scaled windows.

const config = (cfg, key) => Number(cfg.match(new RegExp(`^[ \\t]*${key}[ \\t]+(\\d+)`, 'm'))?.[1]);
// _main.mbc loadChatFonts: values below 2 fall back to font 4.
export function chatFonts(cfg = '') {
  const pick = (key) => (config(cfg, key) >= 2 ? config(cfg, key) : 4);
  return { list: pick('CHAT_LIST_FONT'), edit: pick('CHAT_EDIT_FONT') };
}
// null when config.cfg is missing or the browser cannot read it: chat fonts stay untouched.
export const configChatFonts = (bytes) => (bytes ? chatFonts(decode(bytes)) : null);
export function setChatFonts(cfg, fonts) {
  for (const [key, id] of [
    ['CHAT_LIST_FONT', fonts.list],
    ['CHAT_EDIT_FONT', fonts.edit],
  ]) {
    if (!Number.isInteger(id) || id < 2 || id > 63) throw Error('Некорректный шрифт чата');
    const line = new RegExp(`^([ \\t]*${key}[ \\t]+)\\d+`, 'm');
    cfg = line.test(cfg)
      ? cfg.replace(line, `$1${id}`)
      : cfg + (/\n$/.test(cfg) || !cfg ? '' : '\r\n') + `${key}\t${id}\r\n`;
  }
  return cfg;
}

const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// One recipe per known script version; a list or a single recipe is accepted.
const recipeList = (recipes) => [].concat(recipes);
async function originalFor(bytes, recipe) {
  if ((await sha256(bytes)) === recipe.sourceSha256) return bytes;
  if (bytes.length !== recipe.resultSize) return null;
  const params = Object.values(recipe.params),
    parts = [];
  let at = 0;
  for (const op of recipe.ops) {
    if (Array.isArray(op)) {
      parts.push(bytes.slice(at, at + op[1]));
      at += op[1];
      continue;
    }
    const to = fromHex(op.to);
    for (let i = 0; i < to.length; i++)
      if (bytes[at + i] !== to[i] && !params.some((p) => at + i >= p && at + i < p + 4))
        return null;
    parts.push(fromHex(op.from));
    at += to.length;
  }
  const original = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    original.set(part, offset);
    offset += part.length;
  }
  return (await sha256(original)) === recipe.sourceSha256 ? original : null;
}
// The unpatched script, read from either the original or an earlier patched version.
export async function originalMapScript(bytes, recipes = mapRecipes) {
  for (const recipe of recipeList(recipes)) {
    const original = await originalFor(bytes, recipe);
    if (original) return original;
  }
  return null;
}
// Both scales 1 give back the untouched script.
export async function patchMapScript(original, scales, recipes = mapRecipes) {
  const sha = await sha256(original),
    recipe = recipeList(recipes).find((r) => r.sourceSha256 === sha);
  if (!recipe) throw Error('Неизвестная версия mbc\\st_map.mbc');
  const windows = Object.keys(recipe.params);
  if (windows.every((w) => Math.abs((scales[w] ?? 1) - 1) < 0.001)) return original;
  const result = new Uint8Array(recipe.resultSize);
  let at = 0;
  for (const op of recipe.ops) {
    const part = Array.isArray(op) ? original.subarray(op[0], op[0] + op[1]) : fromHex(op.to);
    result.set(part, at);
    at += part.length;
  }
  const view = new DataView(result.buffer);
  for (const w of windows) {
    const scale = scales[w] ?? 1;
    if (!(scale >= 0.5 && scale <= 4)) throw Error('Масштаб карты: от 50% до 400%');
    view.setFloat32(recipe.params[w], scale, true);
  }
  return result;
}
export const mapScriptName = 'st_map.mbc';

// Assets for one save. read(scope, name) returns the file bytes or null. `game` comes from the
// page: { chatFonts: { list, edit }, mapScales: { minimap, bigmap } }, both optional.
// io (icons only): { list(scope) -> names, uiTexts: [.ui sources] }.
export async function prepareGameAssets(game = {}, read, definitions = [], io = {}) {
  const assets = [],
    warnings = [];
  if (game.chatFonts) {
    for (const id of [game.chatFonts.list, game.chatFonts.edit])
      if (id > 1 && !definitions.some((f) => f.id === id))
        throw Error('Шрифт чата не указан в fonts.cfg');
    const before = await read('root', 'config.cfg');
    if (!before) throw Error('Не найден config.cfg');
    const after = encode(setChatFonts(decode(before), game.chatFonts));
    if (decode(after) !== decode(before)) assets.push({ scope: 'root', name: 'config.cfg', after });
  }
  if (game.mapScales) {
    const before = await read('mbc', mapScriptName);
    const original = before && (await originalMapScript(before));
    if (!original)
      warnings.push(
        'Эта версия mbc\\st_map.mbc не поддерживается: значки на увеличенной карте могут сместиться',
      );
    else {
      const after = await patchMapScript(original, game.mapScales);
      if (after.length !== before.length || after.some((b, i) => b !== before[i]))
        assets.push({ scope: 'mbc', name: mapScriptName, after });
    }
  }
  if (game.iconScale) assets.push(...(await prepareIcons(game.iconScale, { ...io, read })).assets);
  return { assets, warnings };
}
// Scales the current script was built for: 1 for the original, null for an unknown version.
export async function mapScriptScales(bytes, recipes = mapRecipes) {
  if (!bytes) return null;
  const sha = await sha256(bytes);
  for (const recipe of recipeList(recipes)) {
    const windows = Object.keys(recipe.params);
    if (sha === recipe.sourceSha256) return Object.fromEntries(windows.map((w) => [w, 1]));
    if (!(await originalFor(bytes, recipe))) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Object.fromEntries(
      windows.map((w) => [w, Math.round(view.getFloat32(recipe.params[w], true) * 1000) / 1000]),
    );
  }
  return null;
}
