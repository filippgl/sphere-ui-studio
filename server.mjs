import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decode, encode, hash, parse, walk, value, unquote, applyEdits } from './ui-model.mjs';
import { rgbaFromDds, png } from './dds.mjs';
import { resolution } from './layout-core.mjs';
import { prepareFonts, validAsset, backupFile, readSfn } from './font-core.mjs';
import { currentIconScale } from './icons-core.mjs';
import {
  prepareGameAssets,
  configChatFonts,
  mapScriptScales,
  mapScriptName,
} from './game-core.mjs';
import { backupId, historyEntries, restorePlan } from './history-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const settingsPath = path.resolve(arg('--settings') || path.join(here, '.run/settings.json'));
let settings = { recent: [] };
try {
  settings = { ...settings, ...JSON.parse(await fs.readFile(settingsPath, 'utf8')) };
} catch {}
let client = null;
const port = Number(arg('--port') || 5189);
function webOrigin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
    throw Error('Для веб-редактора нужен HTTPS или локальный адрес');
  return url.origin;
}
if (arg('--web-origin')) {
  settings.webOrigins = [
    ...new Set([...(settings.webOrigins || []), webOrigin(arg('--web-origin'))]),
  ];
  await saveSettings();
}
const localOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
const trustedOrigin = (origin) =>
  localOrigins.has(origin) || (settings.webOrigins || []).includes(origin);
let effects, backupRoot;
let names = [];
let validNames = new Set(names);
const imageCache = new Map();
async function readFonts(root) {
  const result = [
    { id: 0, name: 'Классический малый' },
    { id: 1, name: 'Классический крупный' },
  ];
  try {
    const cfg = decode(await fs.readFile(path.join(root, 'fonts.cfg')));
    for (const m of cfg.matchAll(
      /^\s*NEW_FONT_(\d+)\s+"([^"]+)"[^\r\n]*?(?:\/\/\s*([^\r\n]+))?$/gm,
    ))
      result.push({ id: Number(m[1]) + 2, asset: m[2], name: m[3]?.trim() || m[2] });
  } catch {}
  for (const font of result)
    if (font.asset) {
      try {
        font.height = readSfn(
          await fs.readFile(path.join(root, 'effects', font.asset + '.sfn')),
        ).height;
      } catch {}
    }
  return result;
}
let fonts = [];
let strings = {};
let mutation = false;
async function remember(root) {
  settings = {
    ...settings,
    lastClient: root,
    recent: [root, ...(Array.isArray(settings.recent) ? settings.recent : [])]
      .filter((v, i, a) => typeof v === 'string' && a.indexOf(v) === i)
      .slice(0, 12),
  };
  await saveSettings();
}
async function saveSettings() {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath + '.tmp', JSON.stringify(settings, null, 2));
  await fs.rename(settingsPath + '.tmp', settingsPath);
}
async function switchClient(folder) {
  if (mutation) throw Error('Дождитесь предыдущей операции');
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    throw Error('Укажите полный путь к папке игры');
  mutation = true;
  try {
    const next = await fs.realpath(folder);
    const files = await fs.readdir(next);
    if (!files.some((f) => /^sphereclient.*\.exe$/i.test(f)))
      throw Error('В этой папке не найден sphereclient.exe');
    const uiNames = (await fs.readdir(path.join(next, 'effects'))).filter((n) =>
      n.toLowerCase().endsWith('.ui'),
    );
    if (!uiNames.length) throw Error('В папке effects нет окон .ui');
    for (const name of uiNames) parse(decode(await fs.readFile(path.join(next, 'effects', name))));
    const nextStrings = {};
    const nextFonts = await readFonts(next);
    try {
      for (const m of decode(await fs.readFile(path.join(next, 'language/strings.ui'))).matchAll(
        /^\s*string\s+(\w+)\s+"(.*?)"/gm,
      ))
        nextStrings[m[1]] = m[2];
    } catch {}
    await remember(next);
    client = next;
    effects = path.join(next, 'effects');
    backupRoot = path.join(next, '_interface-editor-backups');
    names = uiNames;
    validNames = new Set(uiNames);
    strings = nextStrings;
    fonts = nextFonts;
    imageCache.clear();
    return { client };
  } finally {
    mutation = false;
  }
}
async function clients() {
  const candidates = new Set([client, ...(settings.recent || [])].filter(Boolean));
  const found = new Set();
  for (const candidate of candidates) {
    try {
      const root = await fs.realpath(candidate);
      if (
        (await fs.readdir(root)).some((f) => /^sphereclient.*\.exe$/i.test(f)) &&
        (await fs.stat(path.join(root, 'effects'))).isDirectory()
      )
        found.add(root);
    } catch {}
  }
  return [...found];
}
async function discover(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    throw Error('Выберите каталог для поиска');
  const root = await fs.realpath(folder),
    queue = [[root, 0]],
    found = [];
  let visited = 0;
  while (queue.length && visited < 2000) {
    const [dir, depth] = queue.shift();
    visited++;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    if (
      entries.some((e) => e.isFile() && /^sphereclient.*\.exe$/i.test(e.name)) &&
      entries.some((e) => e.isDirectory() && e.name.toLowerCase() === 'effects')
    )
      found.push(dir);
    if (depth < 3)
      for (const e of entries)
        if (
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          !e.name.startsWith('$') &&
          !e.isSymbolicLink()
        )
          queue.push([path.join(dir, e.name), depth + 1]);
  }
  return { paths: found, visited, limited: queue.length > 0 };
}
let picking = false;
async function pickFolder() {
  if (process.platform !== 'win32') throw Error('Введите путь к папке вручную');
  if (picking) throw Error('Диалог выбора папки уже открыт');
  picking = true;
  try {
    const script =
      "[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Выберите папку клиента или каталог для поиска'; $dialog.ShowNewFolderButton = $false; if ($dialog.ShowDialog() -eq 'OK') { [Console]::Write($dialog.SelectedPath) }; $dialog.Dispose()";
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 300000 },
    );
    return { path: stdout.trim() || null };
  } finally {
    picking = false;
  }
}
const initialClient = arg('--client') || settings.lastClient;
if (initialClient) {
  try {
    await switchClient(initialClient);
  } catch (e) {
    console.error('Не удалось открыть последнюю папку: ' + e.message);
  }
}
async function getFile(name) {
  if (!validNames.has(name)) throw Error('Неизвестный файл интерфейса');
  const bytes = await fs.readFile(path.join(effects, name));
  const text = decode(bytes);
  return { name, hash: hash(bytes), tree: parse(text) };
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8_000_000) throw Error('Слишком большой запрос');
  }
  return JSON.parse(text || '{}');
}
async function backups() {
  if (!client) return [];
  try {
    const ids = [];
    for (const name of await fs.readdir(backupRoot))
      if (/^\d{4}-/.test(name)) {
        try {
          await fs.access(path.join(backupRoot, name, 'manifest.json'));
          let state;
          try {
            state = JSON.parse(
              await fs.readFile(path.join(backupRoot, name, 'transaction.json'), 'utf8'),
            ).state;
          } catch {}
          if (!state || state === 'committed') ids.push(name);
        } catch {}
      }
    return ids.sort().reverse();
  } catch {
    return [];
  }
}
const assetPath = (item) =>
  path.join(
    item.scope === 'root' ? client : item.scope ? path.join(client, item.scope) : effects,
    item.name,
  );
async function optionalRead(target) {
  try {
    return await fs.readFile(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const digest = (bytes) => (bytes === null ? null : hash(bytes));
async function putAsset(item, bytes) {
  const target = assetPath(item);
  if (bytes === null) {
    await fs.rm(target, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target + '.editor-tmp', bytes);
  await fs.rename(target + '.editor-tmp', target);
}
async function save(files, fontScales = [], fontsHash, game = {}) {
  if (!client) throw Error('Сначала выберите папку игры');
  if (mutation) throw Error('Дождитесь предыдущего сохранения');
  mutation = true;
  try {
    if (!Array.isArray(files) || new Set(files.map((f) => f.name)).size !== files.length)
      throw Error('Нет изменений');
    const changes = [];
    const cfg = await optionalRead(path.join(client, 'fonts.cfg'));
    if (fontScales.length && digest(cfg) !== fontsHash)
      throw Error('fonts.cfg изменился. Перечитайте папку');
    const generated = fontScales.length
      ? await prepareFonts(
          fontScales,
          cfg,
          (scope, name) => fs.readFile(path.join(client, scope, name)),
          (scope) => fs.readdir(path.join(client, scope)),
        )
      : { assets: [], definitions: fonts };
    for (const f of files) {
      if (!validNames.has(f.name)) throw Error('Неизвестный файл');
      const before = await fs.readFile(path.join(effects, f.name));
      if (hash(before) !== f.hash)
        throw Error(`${f.name}: файл изменился на диске. Перечитайте его перед сохранением`);
      const fontFields = walk(parse(decode(before)))
        .flatMap((n) => n.props)
        .filter((p) => p.key.toLowerCase() === 'font');
      for (const edit of f.edits)
        if (
          fontFields.some((p) => p.start === edit.start) &&
          !generated.definitions.some((f) => f.id === Number(edit.value))
        )
          throw Error('Этот шрифт не указан в fonts.cfg');
      const after = encode(applyEdits(decode(before), f.edits));
      changes.push({ name: f.name, before, after });
    }
    const extra = await prepareGameAssets(
      game,
      (scope, name) => optionalRead(assetPath({ scope, name })),
      generated.definitions,
      {
        list: async (scope) => {
          try {
            return await fs.readdir(path.join(client, scope));
          } catch {
            return [];
          }
        },
        uiTexts: game?.iconScale
          ? await Promise.all(
              names.map(async (n) => decode(await fs.readFile(path.join(effects, n)))),
            )
          : [],
      },
    );
    for (const asset of [...generated.assets, ...extra.assets]) {
      const before = await optionalRead(assetPath(asset));
      if (
        ['effects', 'xadd'].includes(asset.scope) &&
        before !== null &&
        digest(before) !== digest(asset.after)
      )
        throw Error(`Файл ${asset.name} уже существует с другим содержимым`);
      changes.push({ ...asset, before });
    }
    // Fonts must exist before any UI file starts referring to their IDs.
    if (!changes.length) throw Error('Нет изменений');
    changes.sort((a, b) => Number(!a.scope) - Number(!b.scope));
    const id = backupId(await backups(), randomUUID());
    const dir = path.join(backupRoot, id);
    await fs.mkdir(dir, { recursive: true });
    for (const c of changes)
      if (c.before !== null) await fs.writeFile(path.join(dir, backupFile(c)), c.before);
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        changes.map((c) => ({
          name: c.name,
          ...(c.scope ? { scope: c.scope } : {}),
          before: digest(c.before),
          after: digest(c.after),
        })),
        null,
        2,
      ),
    );
    const written = [];
    await fs.writeFile(path.join(dir, 'transaction.json'), JSON.stringify({ state: 'pending' }));
    try {
      for (const c of changes) {
        // Recheck after the backup, so a launcher update cannot be silently overwritten
        if (digest(await optionalRead(assetPath(c))) !== digest(c.before))
          throw Error(`${c.name}: файл изменился во время сохранения`);
        await putAsset(c, c.after);
        written.push(c);
      }
      await fs.writeFile(
        path.join(dir, 'transaction.json'),
        JSON.stringify({ state: 'committed' }),
      );
    } catch (e) {
      for (const c of written.reverse())
        if (digest(await optionalRead(assetPath(c))) === digest(c.after))
          await putAsset(c, c.before);
      await fs.writeFile(
        path.join(dir, 'transaction.json'),
        JSON.stringify({ state: 'rolled-back' }),
      );
      throw e;
    }
    fonts = await readFonts(client);
    return {
      backup: id,
      files: await Promise.all(changes.filter((c) => !c.scope).map((c) => getFile(c.name))),
      fonts,
      fontsHash: digest(await optionalRead(path.join(client, 'fonts.cfg'))),
      chatFonts: configChatFonts(await optionalRead(path.join(client, 'config.cfg'))),
      mapScales: await mapScriptScales(await optionalRead(path.join(client, 'mbc', mapScriptName))),
      iconScale: await currentIconScale((scope, name) => optionalRead(assetPath({ scope, name }))),
      warnings: extra.warnings,
    };
  } finally {
    mutation = false;
  }
}
async function restore(id) {
  if (!(await backups()).includes(id)) throw Error('Резервная копия не найдена');
  if (mutation) throw Error('Дождитесь сохранения');
  mutation = true;
  try {
    const ids = await backups();
    const plan = await restorePlan(
      id,
      ids,
      async (revision) =>
        JSON.parse(await fs.readFile(path.join(backupRoot, revision, 'manifest.json'), 'utf8')),
      (revision, item) => fs.readFile(path.join(backupRoot, revision, backupFile(item))),
      digest,
      (item) => (item.scope ? validAsset(item) : validNames.has(item.name)),
    );
    const files = await Promise.all(
      plan.files.map(async (item) => ({ ...item, current: await optionalRead(assetPath(item)) })),
    );
    const checkpoint = backupId(ids, randomUUID()),
      dir = path.join(backupRoot, checkpoint);
    await fs.mkdir(dir);
    for (const item of files)
      if (item.current !== null) await fs.writeFile(path.join(dir, backupFile(item)), item.current);
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        files.map((item) => ({
          name: item.name,
          ...(item.scope ? { scope: item.scope } : {}),
          before: digest(item.current),
          after: digest(item.bytes),
        })),
        null,
        2,
      ),
    );
    const transaction = {
      state: 'pending',
      kind: 'restore',
      target: id,
      revisions: plan.revisions,
    };
    await fs.writeFile(path.join(dir, 'transaction.json'), JSON.stringify(transaction));
    const written = [];
    try {
      for (const f of files) {
        if (digest(await optionalRead(assetPath(f))) !== digest(f.current))
          throw Error('Файл изменился во время отката');
        await putAsset(f, f.bytes);
        written.push(f);
      }
      await fs.writeFile(
        path.join(dir, 'transaction.json'),
        JSON.stringify({ ...transaction, state: 'committed' }),
      );
    } catch (e) {
      for (const f of written.reverse())
        if (digest(await optionalRead(assetPath(f))) === digest(f.bytes))
          await putAsset(f, f.current);
      await fs.writeFile(
        path.join(dir, 'transaction.json'),
        JSON.stringify({ ...transaction, state: 'rolled-back' }),
      );
      throw e;
    }
    fonts = await readFonts(client);
    return { restored: files.map((f) => f.name), backup: checkpoint, revisions: plan.revisions };
  } finally {
    mutation = false;
  }
}
async function texture(name) {
  if (!client) throw Error('Сначала выберите папку игры');
  if (!/^[\w-]+$/i.test(name)) throw Error('Неизвестная текстура');
  const key = name.toLowerCase();
  if (imageCache.has(key)) return imageCache.get(key);
  for (const dir of ['textures/fx', 'xadd', 'textures']) {
    const files = await fs.readdir(path.join(client, dir)).catch(() => []);
    const match = files.find((f) => f.toLowerCase() === key + '.dds');
    if (match) {
      const bytes = png(rgbaFromDds(await fs.readFile(path.join(client, dir, match))));
      imageCache.set(key, bytes);
      return bytes;
    }
  }
  throw Error('Текстура отсутствует');
}
const send = (res, status, data, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, {
    ...(res.bridgeOrigin
      ? {
          'Access-Control-Allow-Origin': res.bridgeOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Private-Network': 'true',
          Vary: 'Origin',
        }
      : {}),
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
};
const server = http.createServer(async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${port}`;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`)
      return send(res, 403, { error: 'Локальный доступ' });
    const url = new URL(req.url, origin);
    if (req.headers.origin && !trustedOrigin(req.headers.origin))
      return send(res, 403, { error: 'Чужой источник запроса' });
    if (req.headers.origin && !localOrigins.has(req.headers.origin))
      res.bridgeOrigin = req.headers.origin;
    if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(res, 415, { error: 'Ожидается JSON' });
      const data = await body(req);
      if (url.pathname === '/api/web-origin') {
        if (req.headers.origin && !localOrigins.has(req.headers.origin))
          return send(res, 403, { error: 'Разрешить сайт можно только локально' });
        settings.webOrigins = [
          ...new Set([...(settings.webOrigins || []), webOrigin(data.origin)]),
        ];
        await saveSettings();
        return send(res, 200, { webOrigins: settings.webOrigins });
      }
      if (url.pathname === '/api/client') return send(res, 200, await switchClient(data.path));
      if (url.pathname === '/api/discover') return send(res, 200, await discover(data.path));
      if (url.pathname === '/api/pick-folder') return send(res, 200, await pickFolder());
      if (data.client && data.client !== client)
        throw Error('Выбрана другая папка игры. Перечитайте страницу перед сохранением');
      if (url.pathname === '/api/save')
        return send(res, 200, await save(data.files, data.fontScales, data.fontsHash, data.game));
      if (url.pathname === '/api/restore') return send(res, 200, await restore(data.id));
      return send(res, 404, { error: 'Неизвестная команда' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Метод не поддерживается' });
    if (url.pathname === '/api/catalog') {
      if (mutation) throw Error('Дождитесь завершения операции');
      const root = client;
      const files = await Promise.all(names.map(getFile));
      if (root !== client) throw Error('Папка переключена, перечитайте страницу');
      const cfg = client ? await optionalRead(path.join(client, 'fonts.cfg')) : null;
      const config = client ? await optionalRead(path.join(client, 'config.cfg')) : null;
      return send(res, 200, {
        client,
        files,
        strings,
        fonts,
        fontsHash: digest(cfg),
        resolution: config ? resolution(decode(config)) : null,
        chatFonts: configChatFonts(config),
        mapScales: client
          ? await mapScriptScales(await optionalRead(path.join(client, 'mbc', mapScriptName)))
          : null,
        iconScale: client
          ? await currentIconScale((scope, name) => optionalRead(assetPath({ scope, name })))
          : 1,
        backups: await backups(),
        webOrigins: settings.webOrigins || [],
      });
    }
    if (url.pathname === '/api/clients') return send(res, 200, await clients());
    if (url.pathname === '/api/backups') return send(res, 200, await backups());
    if (url.pathname === '/api/history')
      return send(
        res,
        200,
        await historyEntries(
          await backups(),
          async (id) => {
            const dir = path.join(backupRoot, id);
            let transaction;
            try {
              transaction = JSON.parse(
                await fs.readFile(path.join(dir, 'transaction.json'), 'utf8'),
              );
            } catch {}
            return {
              manifest: JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')),
              transaction,
            };
          },
          (item) => (item.scope ? validAsset(item) : validNames.has(item.name)),
        ),
      );
    if (url.pathname === '/api/texture')
      return send(res, 200, await texture(url.searchParams.get('name') || ''), 'image/png');
    const staticFiles = {
      '/': ['index.html', 'text/html'],
      '/app.mjs': ['app.mjs', 'text/javascript'],
      '/style.css': ['style.css', 'text/css'],
      '/ui-model.mjs': ['ui-model.mjs', 'text/javascript'],
      '/storage.mjs': ['storage.mjs', 'text/javascript'],
      '/runtime.mjs': ['runtime.mjs', 'text/javascript'],
      '/browser-storage.mjs': ['browser-storage.mjs', 'text/javascript'],
      '/browser-files.mjs': ['browser-files.mjs', 'text/javascript'],
      '/zip.mjs': ['zip.mjs', 'text/javascript'],
      '/ui-core.mjs': ['ui-core.mjs', 'text/javascript'],
      '/dds-core.mjs': ['dds-core.mjs', 'text/javascript'],
      '/layout-core.mjs': ['layout-core.mjs', 'text/javascript'],
      '/chat-core.mjs': ['chat-core.mjs', 'text/javascript'],
      '/hotbar-core.mjs': ['hotbar-core.mjs', 'text/javascript'],
      '/font-core.mjs': ['font-core.mjs', 'text/javascript'],
      '/history-core.mjs': ['history-core.mjs', 'text/javascript'],
    };
    if (staticFiles[url.pathname]) {
      const [name, type] = staticFiles[url.pathname];
      return send(res, 200, await fs.readFile(path.join(here, name)), type + '; charset=utf-8');
    }
    if (url.pathname === '/api/research')
      return send(
        res,
        200,
        await fs.readFile(path.join(here, 'WINDOWS.md')),
        'text/plain; charset=utf-8',
      );
    return send(res, 404, { error: 'Не найдено' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Редактор интерфейса: http://127.0.0.1:${port}\nКлиент: ${client || 'не выбран'}`),
);
