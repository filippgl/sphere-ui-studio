import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { decode, parse, walk, prop, applyEdits } from './ui-model.mjs';
import { crc32 } from './zip.mjs';
import { readSfn } from './font-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const original = process.env.SPHERE_CLIENT || process.argv[2];
if (!original) throw Error('Укажите папку клиента в SPHERE_CLIENT или первым аргументом');
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'sphere-online-'));
const payload = [];
async function add(name, bytes) {
  const target = path.join(fixture, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  payload.push({ name, bytes: bytes.toString('base64') });
}
await add('sphereclient.exe', Buffer.from('fixture'));
for (const name of (await fs.readdir(path.join(original, 'effects'))).filter((n) =>
  /\.ui$/i.test(n),
))
  await add('effects/' + name, await fs.readFile(path.join(original, 'effects', name)));
for (const name of ['fonts.cfg', 'language/strings.ui', 'textures/fx/i_pick01.dds'])
  await add(name, await fs.readFile(path.join(original, name)));
for (const folder of ['effects', 'xadd'])
  for (const name of await fs.readdir(path.join(original, folder)))
    if (/^fnt_sphere[01](?:_(?:d|f|i|p|spa))?\.(?:sfn|dds)$/i.test(name))
      await add(folder + '/' + name, await fs.readFile(path.join(original, folder, name)));
const before = await fs.readFile(path.join(fixture, 'effects/pickpers.ui'));
const root = walk(parse(decode(before))).find((n) => n.kind === 'windowUI'),
  field = prop(root, 'size');
const [width, height] = field.value.split(/\s+/).map(Number);
const expected = applyEdits(decode(before), [
  { start: field.start, end: field.end, value: `${width + 50} ${height}` },
]);
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const staticFiles = new Set(await fs.readdir(path.join(here, 'dist')));
const requests = [];
const server = http.createServer(async (req, res) => {
  requests.push({ method: req.method, path: req.url });
  if (req.url === '/__fixture.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1'),
    name = url.pathname.slice('/sphere/ui/'.length) || 'index.html';
  if (!url.pathname.startsWith('/sphere/ui/') || !staticFiles.has(name)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const type = name.endsWith('.mjs')
    ? 'text/javascript'
    : name.endsWith('.css')
      ? 'text/css'
      : name.endsWith('.html')
        ? 'text/html'
        : 'text/plain';
  res.writeHead(200, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(await fs.readFile(path.join(here, 'dist', name)));
});
await new Promise((resolve) => server.listen(5192, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:5192/sphere/ui/';
const browserName = process.env.BROWSER || 'chromium';
const engine = (await import(process.env.PLAYWRIGHT_MODULE || 'playwright'))[browserName];
if (!engine) throw Error('Неизвестный браузер: ' + browserName);
let browser;
function zipFiles(bytes) {
  const files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18),
      nameLength = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength),
      start = offset + 30 + nameLength + extra,
      body = bytes.subarray(start, start + length);
    assert.equal(bytes.readUInt32LE(offset + 14), crc32(body));
    files.set(name, body);
    offset = start + length;
  }
  return files;
}
try {
  browser = await engine.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE || (browserName === 'chromium' && process.env.CHROMIUM)
      ? { executablePath: process.env.BROWSER_EXECUTABLE || process.env.CHROMIUM }
      : {}),
  });
  if (browserName === 'chromium') {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.addInitScript(() => {
      window.showDirectoryPicker = async (options) => {
        window.directoryOptions = options;
        return (await navigator.storage.getDirectory()).getDirectoryHandle('client-fixture', {
          create: true,
        });
      };
    });
    await page.goto(url);
    await page.locator('#welcome-open').waitFor({ state: 'visible' });
    check(
      await page
        .locator('#storage-mode')
        .textContent()
        .then((s) => s.includes('Онлайн')),
      'Статическая версия стартует без сервера файлов',
    );
    await page.evaluate(async () => {
      const files = await (await fetch('/__fixture.json')).json(),
        root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('client-fixture', { create: true });
      for (const file of files) {
        const parts = file.name.split('/');
        let dir = root;
        for (const part of parts.slice(0, -1))
          dir = await dir.getDirectoryHandle(part, { create: true });
        const handle = await dir.getFileHandle(parts.at(-1), { create: true }),
          stream = await handle.createWritable();
        await stream.write(Uint8Array.from(atob(file.bytes), (c) => c.charCodeAt(0)));
        await stream.close();
      }
    });
    const fileBytes = (name) =>
      page
        .evaluate(async (name) => {
          const root = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('client-fixture');
          const parts = name.split('/');
          let dir = root;
          for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
          return Array.from(
            new Uint8Array(
              await (await (await dir.getFileHandle(parts.at(-1))).getFile()).arrayBuffer(),
            ),
          );
        }, name)
        .then((bytes) => Buffer.from(bytes));
    const writeBytes = (name, bytes) =>
      page.evaluate(
        async ({ name, bytes }) => {
          const root = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('client-fixture');
          const parts = name.split('/');
          let dir = root;
          for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
          const stream = await (await dir.getFileHandle(parts.at(-1))).createWritable();
          await stream.write(Uint8Array.from(bytes));
          await stream.close();
        },
        { name, bytes: [...bytes] },
      );
    await page.locator('#welcome-open').click();
    await page.locator('#browse-client').click();
    await page.waitForFunction(
      () => document.getElementById('browser-folder-name').textContent === 'client-fixture',
    );
    check(
      await page.evaluate(() => window.directoryOptions.mode === 'readwrite'),
      'Папка запрашивается с разрешением чтения и записи',
    );
    await page.locator('#connect-client').click();
    await page.waitForFunction(() => document.querySelectorAll('.layer').length > 1);
    await page.locator('#scale-open').click();
    await page.locator('#scale').selectOption('1.5');
    await page.locator('#scale-window').click();
    await page.locator('#save').click();
    await page.waitForFunction(
      () => document.getElementById('dirty').textContent === 'Нет изменений',
    );
    check(
      decode(await fileBytes('fonts.cfg')).includes('studio_f3_1500'),
      'Онлайн-редактор записывает fonts.cfg через файловый API',
    );
    check(
      readSfn(await fileBytes('effects/studio_f3_1500.sfn')).height ===
        Math.round(
          readSfn(await fs.readFile(path.join(original, 'effects/fnt_sphere1.sfn'))).height * 1.5,
        ),
      'Метрики букв увеличены в настоящем браузерном файле',
    );
    await page.locator('#history').click();
    await page.getByRole('button', { name: 'Восстановить', exact: true }).first().click();
    await page.waitForFunction(() => !document.getElementById('backup-dialog').open);
    check(
      (await fileBytes('effects/pickpers.ui')).equals(before),
      'Откат онлайн-масштабирования восстанавливает UI',
    );
    check(
      !decode(await fileBytes('fonts.cfg')).includes('studio_f3_1500'),
      'Откат онлайн-масштабирования восстанавливает реестр шрифтов',
    );
    check(
      (await page.locator('#client-summary').textContent()) === 'client-fixture',
      'Показана выбранная пользователем папка',
    );
    await page.locator('#tab-windows').click();
    check(
      (await page.locator('.window-item').count()) === 93,
      '93 окна читаются браузером с диска',
    );
    await page.locator('#tab-layers').click();
    await page.locator('#scale-open').click();
    await page.locator('#scale-contents').uncheck();
    await page.locator('#scale-open').click();
    const texture = await page.evaluate(async () => {
      const { BrowserStorage } = await import('./browser-storage.mjs'),
        store = await BrowserStorage.open(),
        url = await store.texture('i_pick01');
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: image.width, blob: url.startsWith('blob:') };
    });
    check(
      texture.width === 256 && texture.blob,
      'DDS декодируется в браузере без отправки текстуры на сервер',
    );
    await page.getByLabel('Ширина', { exact: true }).fill(String(width + 50));
    await page.getByLabel('Ширина', { exact: true }).press('Tab');
    await page.locator('#save').click();
    await page.waitForFunction(
      () => document.getElementById('dirty').textContent === 'Нет изменений',
    );
    const savedBytes = await fileBytes('effects/pickpers.ui');
    check(
      decode(savedBytes) === expected,
      'Сайт записывает правку через настоящий FileSystemWritableFileStream',
    );
    const ids = await page.evaluate(async () => {
      const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('client-fixture'),
        dir = await root.getDirectoryHandle('_interface-editor-backups');
      const names = [];
      for await (const [name] of dir.entries()) names.push(name);
      return names;
    });
    check(ids.length === 2, 'Резервные копии шрифта и геометрии созданы внутри выбранной папки');
    check(
      (await fileBytes(`_interface-editor-backups/${ids[0]}/pickpers.ui`)).equals(before),
      'Бэкап сохраняет точные байты Windows-1251 и CRLF',
    );
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.layer').length > 1);
    check(
      Number(await page.getByLabel('Ширина', { exact: true }).inputValue()) === width + 50,
      'Папка и разрешённый доступ восстанавливаются через IndexedDB после обновления',
    );
    await writeBytes(
      'effects/pickpers.ui',
      Buffer.concat([savedBytes, Buffer.from('// external')]),
    );
    await page.getByLabel('Ширина', { exact: true }).fill(String(width + 60));
    await page.getByLabel('Ширина', { exact: true }).press('Tab');
    await page.locator('#save').click();
    await page.waitForFunction(() =>
      document.getElementById('toast-text').textContent.includes('изменился'),
    );
    check(
      (await fileBytes('effects/pickpers.ui')).toString('ascii').endsWith('// external'),
      'Внешние изменения не перезаписываются',
    );
    await page.locator('#undo').click();
    await page.locator('#history').click();
    await page.getByRole('button', { name: 'Восстановить', exact: true }).first().click();
    await page.waitForFunction(() =>
      document.getElementById('toast-text').textContent.includes('файл менялся'),
    );
    check(
      await page.locator('#backup-dialog').evaluate((d) => d.open),
      'Конфликт отката показывается без ложного сообщения об успехе',
    );
    await writeBytes('effects/pickpers.ui', savedBytes);
    await page.getByRole('button', { name: 'Восстановить', exact: true }).first().click();
    await page.waitForFunction(() => !document.getElementById('backup-dialog').open);
    check(
      (await fileBytes('effects/pickpers.ui')).equals(before),
      'Откат на сайте восстанавливает оригинал в той же папке',
    );
    check(errors.length === 0, 'Онлайн-версия не выдаёт ошибок JavaScript: ' + errors.join('; '));
    check(
      requests.every((r) => r.method === 'GET' && !r.path.includes('/api/')),
      'Открытие, текстуры, сохранение и бэкапы не используют серверное API и загрузку файлов',
    );
    await page.screenshot({ path: path.join(here, 'test-online.png') });
  }
  const fallbackContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const fallback = await fallbackContext.newPage();
  const fallbackErrors = [];
  fallback.on('pageerror', (error) => fallbackErrors.push(error.message));
  fallback.setDefaultTimeout(15000);
  await fallback.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
  await fallback.goto(url);
  await fallback.locator('#welcome-open').click();
  check(
    await fallback
      .locator('#storage-description')
      .textContent()
      .then((t) => t.includes('ZIP')),
    'Браузер без прямой записи получает понятный режим архива',
  );
  await fallback.locator('#folder-files').setInputFiles(fixture);
  await fallback.waitForFunction(() => document.querySelectorAll('.layer').length > 1);
  await fallback.locator('#scale-open').click();
  await fallback.locator('#scale-contents').uncheck();
  await fallback.locator('#scale-open').click();
  await fallback.waitForFunction(() => document.querySelectorAll('.layer').length > 1);
  await fallback.getByLabel('Ширина', { exact: true }).fill(String(width + 50));
  await fallback.getByLabel('Ширина', { exact: true }).press('Tab');
  check(
    await fallback
      .locator('#save')
      .textContent()
      .then((t) => t.includes('Скачать изменения')),
    'Кнопка архива не обещает запись в исходные файлы',
  );
  const downloading = fallback.waitForEvent('download');
  await fallback.locator('#save').click();
  const archivePath = path.join(fixture, 'changes.zip');
  await (await downloading).saveAs(archivePath);
  const archived = zipFiles(await fs.readFile(archivePath));
  check(
    decode(archived.get('effects/pickpers.ui')) === expected,
    'ZIP содержит изменённый файл с правильной кодировкой',
  );
  const backup = [...archived.keys()].find(
    (name) => name.startsWith('_interface-editor-backups/') && name.endsWith('/pickpers.ui'),
  );
  check(
    archived.get(backup).equals(before),
    'ZIP включает точный оригинал и манифест резервной копии',
  );
  check(
    (await fs.readFile(path.join(fixture, 'effects/pickpers.ui'))).equals(before),
    'Режим ZIP не меняет исходные файлы без доступа',
  );
  check(
    await fallback
      .locator('#toast-text')
      .textContent()
      .then((t) => t.includes('Распакуйте')),
    'После выгрузки ясно указано оставшееся действие пользователя',
  );
  await fallback.locator('#scale-open').click();
  await fallback.locator('#scale').selectOption('1.5');
  await fallback.locator('#scale-window').click();
  const fontDownload = fallback.waitForEvent('download');
  await fallback.locator('#save').click();
  const fontArchive = path.join(fixture, 'fonts.zip');
  await (await fontDownload).saveAs(fontArchive);
  const fontFiles = zipFiles(await fs.readFile(fontArchive));
  check(
    fontFiles.has('fonts.cfg') &&
      fontFiles.has('effects/studio_f3_1500.sfn') &&
      fontFiles.has('xadd/studio_f3_1500.dds'),
    'ZIP включает все необходимые файлы увеличенного шрифта',
  );
  check(
    [...fontFiles.keys()].some((name) => name.endsWith('/root--fonts.cfg')),
    'ZIP сохраняет исходную конфигурацию шрифтов в бэкапе',
  );
  check(
    fallbackErrors.length === 0,
    'Режим архива работает без ошибок: ' + fallbackErrors.join('; '),
  );
  console.log(`PASS: ${checks} online checks (${browserName}); fixture ${fixture}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
