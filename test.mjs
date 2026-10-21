import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode, encode, parse, walk, prop, applyEdits, hash } from './ui-model.mjs';
import { rgbaFromDds, png } from './dds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const original = process.env.SPHERE_CLIENT || process.argv[2];
if (!original) throw Error('Укажите папку клиента в SPHERE_CLIENT или первым аргументом');
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'sphere-ui-test-'));
const effects = path.join(fixture, 'effects');
await fs.mkdir(effects);
await fs.writeFile(path.join(fixture, 'sphereclient.exe'), 'fixture');
await fs.copyFile(path.join(original, 'fonts.cfg'), path.join(fixture, 'fonts.cfg'));
await fs.mkdir(path.join(fixture, 'language'));
await fs.copyFile(
  path.join(original, 'language/strings.ui'),
  path.join(fixture, 'language/strings.ui'),
);
await fs.symlink(path.resolve(original, 'textures'), path.join(fixture, 'textures'), 'junction');
await fs.mkdir(path.join(fixture, 'xadd'));
for (const family of ['fnt_sphere0', 'fnt_sphere1']) {
  for (const name of (await fs.readdir(path.join(original, 'effects'))).filter((n) =>
    new RegExp(`^${family}(?:_(?:d|f|i|p|spa))?\\.sfn$`, 'i').test(n),
  ))
    await fs.copyFile(path.join(original, 'effects', name), path.join(effects, name));
  for (const name of (await fs.readdir(path.join(original, 'xadd'))).filter((n) =>
    new RegExp(`^${family}(?:_(?:d|f|i|p|spa))?\\.dds$`, 'i').test(n),
  ))
    await fs.copyFile(path.join(original, 'xadd', name), path.join(fixture, 'xadd', name));
}
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
for (const name of (await fs.readdir(path.join(original, 'effects'))).filter((n) =>
  n.endsWith('.ui'),
)) {
  const bytes = await fs.readFile(path.join(original, 'effects', name));
  const text = decode(bytes),
    model = parse(text);
  check(encode(text).equals(bytes), `${name}: кодировка без потерь`);
  for (const n of walk(model))
    for (const p of n.props)
      assert.equal(text.slice(p.start, p.end), p.value, `${name}: границы ${p.key}`);
  await fs.writeFile(path.join(effects, name), bytes);
}
const dds = await fs.readFile(path.join(original, 'textures/fx/i_pick01.dds'));
const picture = rgbaFromDds(dds);
check(picture.width === 256 && picture.height === 256, 'Размер текстуры');
check(png(picture).subarray(1, 4).toString() === 'PNG', 'Текстуры преобразуются в PNG');
const sample = decode(await fs.readFile(path.join(effects, 'pickpers.ui')));
const root = walk(parse(sample)).find((n) => n.kind === 'windowUI');
const size = prop(root, 'size');
const [baseWidth, baseHeight] = size.value.split(/\s+/).map(Number);
const newSize = `500 ${baseHeight}`;
const edited = applyEdits(sample, [{ start: size.start, end: size.end, value: newSize }]);
check(
  edited.slice(0, size.start) === sample.slice(0, size.start) &&
    edited.slice(size.start + newSize.length) === sample.slice(size.end),
  'Сохраняется окружающий текст',
);
assert.throws(() => applyEdits(sample, [{ start: size.start, end: size.end, value: '0 -4' }]));
checks++;

const port = 5190;
const settings = path.join(fixture, 'editor-settings.json');
const server = spawn(
  process.execPath,
  ['server.mjs', '--client', fixture, '--settings', settings, '--port', String(port)],
  { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
await new Promise((resolve, reject) => {
  server.stdout.once('data', resolve);
  server.once('error', reject);
  server.once('exit', (code) => reject(Error('Server exited ' + code)));
});
const url = `http://127.0.0.1:${port}`;
const request = async (endpoint, body, headers = {}) => {
  const res = await fetch(
    url + endpoint,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }
      : { headers },
  );
  return { status: res.status, data: await res.json() };
};
let browser;
try {
  const pack = (await request('/hd/manifest.json')).data;
  check(
    pack.version === 1 && pack.entries.length > 0,
    'Локальный сервер отдаёт манифест HD как JSON',
  );
  const packedTexture = await fetch(url + '/hd/' + pack.entries[0].file);
  check(
    hash(Buffer.from(await packedTexture.arrayBuffer())) === pack.entries[0].compressedSha256,
    'Локальный сервер отдаёт сжатый DDS без изменения байтов',
  );
  const catalog = (await request('/api/catalog')).data;
  check(catalog.files.length === 87, 'Все 87 файлов читаются');
  check(
    catalog.files.flatMap((f) => walk(f.tree)).filter((n) => n.kind === 'windowUI').length === 93,
    '93 окна',
  );
  const file = catalog.files.find((f) => f.name === 'pickpers.ui');
  const saveBody = {
    files: [
      {
        name: file.name,
        hash: file.hash,
        edits: [{ start: size.start, end: size.end, value: newSize }],
      },
    ],
  };
  check(
    (await request('/api/save', saveBody, { Origin: 'https://example.com' })).status === 403,
    'Чужой сайт не пишет в клиент',
  );
  const saved = await request('/api/save', saveBody);
  check(saved.status === 200, 'Сохранение на копии клиента');
  check(
    decode(await fs.readFile(path.join(effects, file.name))) === edited,
    'На диск записаны только правки',
  );
  check(
    (await request('/api/save', saveBody)).status === 400,
    'Устаревшая версия не перезаписывает изменения',
  );
  check(
    (await request('/api/save', { files: [{ ...saveBody.files[0], name: '../fonts.cfg' }] }))
      .status === 400,
    'Пути вне effects отклоняются',
  );
  check((await request('/api/restore', { id: saved.data.backup })).status === 200, 'Откат');
  check(hash(await fs.readFile(path.join(effects, file.name))) === file.hash, 'Откат байт в байт');
  const webOrigin = 'https://studio.example';
  check(
    (await request('/api/web-origin', { origin: webOrigin })).status === 200,
    'Веб-источник подключается только через локальный помощник',
  );
  const preflight = await fetch(url + '/api/save', {
    method: 'OPTIONS',
    headers: {
      Origin: webOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  check(
    preflight.ok &&
      preflight.headers.get('access-control-allow-origin') === webOrigin &&
      preflight.headers.get('access-control-allow-private-network') === 'true',
    'Разрешённый веб-редактор проходит CORS и preflight локальной сети',
  );
  check(
    (await request('/api/catalog', undefined, { Origin: webOrigin })).status === 200,
    'Разрешённый сайт читает выбранную локальную копию',
  );
  check(
    (await request('/api/web-origin', { origin: 'https://other.example' }, { Origin: webOrigin }))
      .status === 403,
    'Веб-сайт не может добавлять новые разрешённые источники',
  );
  const quickBefore = await fs.readFile(path.join(effects, 'quickitems.ui'));
  const saveSize = async (name, value) => {
    const current = (await request('/api/catalog')).data.files.find((f) => f.name === name);
    const field = prop(
      walk(current.tree).find((n) => n.kind === 'windowUI'),
      'size',
    );
    const result = await request('/api/save', {
      files: [{ name, hash: current.hash, edits: [{ start: field.start, end: field.end, value }] }],
    });
    check(result.status === 200, 'Сохранение следующей ревизии для цепочки отката');
    return result.data.backup;
  };
  const oldRevision = await saveSize(file.name, newSize);
  await saveSize('quickitems.ui', '52 506');
  await saveSize(file.name, `600 ${baseHeight}`);
  const beforeRollback = await fs.readFile(path.join(effects, file.name));
  const oldRestore = await request('/api/restore', { id: oldRevision });
  check(
    oldRestore.status === 200 && oldRestore.data.revisions.length === 3,
    'Старая ревизия сразу откатывает всю последующую цепочку',
  );
  check(
    hash(await fs.readFile(path.join(effects, file.name))) === file.hash &&
      (await fs.readFile(path.join(effects, 'quickitems.ui'))).equals(quickBefore),
    'Откат цепочки восстанавливает оба окна',
  );
  const undoRestore = await request('/api/restore', { id: oldRestore.data.backup });
  check(
    undoRestore.status === 200 &&
      (await fs.readFile(path.join(effects, file.name))).equals(beforeRollback),
    'Автоматическая точка возвращает состояние до отката',
  );
  check(
    (await request('/api/restore', { id: oldRevision })).status === 200,
    'Повторный выбор старой точки учитывает историю откатов',
  );

  const playwright = process.env.PLAYWRIGHT_MODULE || 'playwright';
  const { chromium } = await import(playwright);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  });
  const { browserChecks } = await import('./browser-checks.mjs');
  await browserChecks({
    browser,
    url,
    check,
    fixture,
    effects,
    file,
    baseWidth,
    baseHeight,
    request,
  });
  console.log(`PASS: ${checks} checks; client files were not modified; fixture ${fixture}`);
} finally {
  await browser?.close();
  server.kill();
}
