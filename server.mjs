import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decode, encode, hash, parse, walk, value, unquote, applyEdits } from './ui-model.mjs';
import { rgbaFromDds, png } from './dds.mjs';

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
      result.push({ id: Number(m[1]) + 2, name: m[3]?.trim() || m[2] });
  } catch {}
  return result;
}
let fonts = [];
let strings = {};
let mutation = false;
async function remember(root) {
  settings = {
    lastClient: root,
    recent: [root, ...(Array.isArray(settings.recent) ? settings.recent : [])]
      .filter((v, i, a) => typeof v === 'string' && a.indexOf(v) === i)
      .slice(0, 12),
  };
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
async function save(files) {
  if (!client) throw Error('Сначала выберите папку игры');
  if (mutation) throw Error('Дождитесь предыдущего сохранения');
  mutation = true;
  try {
    if (
      !Array.isArray(files) ||
      files.length === 0 ||
      new Set(files.map((f) => f.name)).size !== files.length
    )
      throw Error('Нет изменений');
    const changes = [];
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
          !fonts.some((f) => f.id === Number(edit.value))
        )
          throw Error('Этот шрифт не указан в fonts.cfg');
      const after = encode(applyEdits(decode(before), f.edits));
      changes.push({ name: f.name, before, after });
    }
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6);
    const dir = path.join(backupRoot, id);
    await fs.mkdir(dir, { recursive: true });
    for (const c of changes) await fs.writeFile(path.join(dir, c.name), c.before);
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        changes.map((c) => ({ name: c.name, before: hash(c.before), after: hash(c.after) })),
        null,
        2,
      ),
    );
    const written = [];
    try {
      for (const c of changes) {
        // Recheck after the backup, so a launcher update cannot be silently overwritten
        if (hash(await fs.readFile(path.join(effects, c.name))) !== hash(c.before))
          throw Error(`${c.name}: файл изменился во время сохранения`);
        await fs.writeFile(path.join(effects, c.name + '.editor-tmp'), c.after);
        await fs.rename(path.join(effects, c.name + '.editor-tmp'), path.join(effects, c.name));
        written.push(c);
      }
    } catch (e) {
      for (const c of written) await fs.writeFile(path.join(effects, c.name), c.before);
      throw e;
    }
    return { backup: id, files: await Promise.all(changes.map((c) => getFile(c.name))) };
  } finally {
    mutation = false;
  }
}
async function restore(id) {
  if (!(await backups()).includes(id)) throw Error('Резервная копия не найдена');
  if (mutation) throw Error('Дождитесь сохранения');
  mutation = true;
  try {
    const dir = path.join(backupRoot, id);
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const files = [];
    for (const item of manifest) {
      if (!validNames.has(item.name)) throw Error('Неизвестный файл в резервной копии');
      const current = await fs.readFile(path.join(effects, item.name));
      if (hash(current) !== item.after)
        throw Error(
          `${item.name}: после этой копии файл менялся. Сначала откатите более новые изменения`,
        );
      const bytes = await fs.readFile(path.join(dir, item.name));
      if (hash(bytes) !== item.before) throw Error('Резервная копия повреждена');
      files.push({ name: item.name, bytes, current });
    }
    const written = [];
    try {
      for (const f of files) {
        await fs.writeFile(path.join(effects, f.name), f.bytes);
        written.push(f);
      }
    } catch (e) {
      for (const f of written) await fs.writeFile(path.join(effects, f.name), f.current);
      throw e;
    }
    return { restored: files.map((f) => f.name) };
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
    if (req.method === 'POST') {
      if (req.headers.origin && ![origin, `http://localhost:${port}`].includes(req.headers.origin))
        return send(res, 403, { error: 'Чужой источник запроса' });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(res, 415, { error: 'Ожидается JSON' });
      const data = await body(req);
      if (url.pathname === '/api/client') return send(res, 200, await switchClient(data.path));
      if (url.pathname === '/api/discover') return send(res, 200, await discover(data.path));
      if (url.pathname === '/api/pick-folder') return send(res, 200, await pickFolder());
      if (data.client && data.client !== client)
        throw Error('Выбрана другая папка игры. Перечитайте страницу перед сохранением');
      if (url.pathname === '/api/save') return send(res, 200, await save(data.files));
      if (url.pathname === '/api/restore') return send(res, 200, await restore(data.id));
      return send(res, 404, { error: 'Неизвестная команда' });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Метод не поддерживается' });
    if (url.pathname === '/api/catalog') {
      if (mutation) throw Error('Дождитесь завершения операции');
      const root = client;
      const files = await Promise.all(names.map(getFile));
      if (root !== client) throw Error('Папка переключена, перечитайте страницу');
      return send(res, 200, { client, files, strings, fonts, backups: await backups() });
    }
    if (url.pathname === '/api/clients') return send(res, 200, await clients());
    if (url.pathname === '/api/backups') return send(res, 200, await backups());
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
