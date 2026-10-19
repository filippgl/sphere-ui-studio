import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStorage, sha256 } from './browser-storage.mjs';
import { UploadedDirectory, child, read, write } from './browser-files.mjs';
import { encode, decode, prop } from './ui-core.mjs';
import { zip, crc32 } from './zip.mjs';

const source =
  '// Тест\r\nwindowUI\r\n{\r\n windowName "test"\r\n size 200 100\r\n font 3\r\n}\r\n';
async function fixture() {
  const root = new UploadedDirectory('client'),
    effects = await child(root, 'effects', 'directory', true);
  await write(root, 'sphereclient.exe', new Uint8Array());
  await write(root, 'fonts.cfg', encode('NEW_FONT_1 "font"'));
  for (const name of ['first.ui', 'second.ui']) await write(effects, name, encode(source));
  const store = new BrowserStorage(),
    record = await store.register(root);
  await store.select(record.id);
  return { root, effects, store, record };
}
function patch(file, size = '300 150') {
  const p = prop(file.tree.children[0], 'size');
  return { name: file.name, hash: file.hash, edits: [{ start: p.start, end: p.end, value: size }] };
}
test('Онлайн-хранилище читает папку и создаёт совместимые бэкапы перед записью', async () => {
  const { root, effects, store } = await fixture(),
    before = await store.catalog();
  assert.equal(before.files.length, 2);
  const saved = await store.save(before.files.map((f) => patch(f)));
  assert.equal(saved.files.length, 2);
  assert.match(decode(await read(effects, 'first.ui')), /size 300 150/);
  const dir = await child(await child(root, '_interface-editor-backups'), saved.backup);
  assert.equal(decode(await read(dir, 'first.ui')), source);
  const manifest = JSON.parse(new TextDecoder().decode(await read(dir, 'manifest.json')));
  assert.equal(manifest[0].before, await sha256(encode(source)));
  assert.deepEqual(await store.backups(), [saved.backup]);
  await store.restore(saved.backup);
  assert.equal(decode(await read(effects, 'first.ui')), source);
  assert.equal(decode(await read(effects, 'second.ui')), source);
});
test('Сайт не перезаписывает внешние изменения, ошибочные пути и несуществующие шрифты', async () => {
  const { effects, store } = await fixture(),
    before = await store.catalog();
  await write(effects, 'first.ui', encode(source + '// внешняя правка'));
  await assert.rejects(store.save([patch(before.files[0])]), /изменился/);
  await assert.rejects(
    store.save([{ ...patch(before.files[1]), name: '../secret' }]),
    /Неизвестный/,
  );
  const font = prop(before.files[1].tree.children[0], 'font');
  await assert.rejects(
    store.save([
      {
        name: 'second.ui',
        hash: before.files[1].hash,
        edits: [{ start: font.start, end: font.end, value: '63' }],
      },
    ]),
    /шрифт/,
  );
  assert.equal(decode(await read(effects, 'first.ui')), source + '// внешняя правка');
  assert.deepEqual(await store.backups(), []);
});
test('Ошибка записи второго файла откатывает первый и сохраняет исходники', async () => {
  const { root, effects, store } = await fixture(),
    before = await store.catalog();
  const failedFile = await child(effects, 'second.ui', 'file');
  failedFile.createWritable = async () => {
    throw new DOMException('Нет доступа', 'NotAllowedError');
  };
  await assert.rejects(store.save(before.files.map((f) => patch(f))), /Нет доступа/);
  assert.equal(decode(await read(effects, 'first.ui')), source);
  assert.equal(decode(await read(effects, 'second.ui')), source);
  const backups = await child(root, '_interface-editor-backups');
  for await (const dir of backups.values())
    assert.equal(decode(await read(dir, 'first.ui')), source);
  assert.deepEqual(await store.backups(), []);
});
test('Повреждённая копия и изменённый после сохранения файл не проходят откат', async () => {
  const { root, effects, store } = await fixture(),
    before = await store.catalog();
  const saved = await store.save([patch(before.files[0])]);
  const dir = await child(await child(root, '_interface-editor-backups'), saved.backup);
  await write(dir, 'first.ui', encode('Повреждено'));
  await assert.rejects(store.restore(saved.backup), /повреждена/);
  await write(dir, 'first.ui', encode(source));
  await write(effects, 'first.ui', encode(source + '// новая версия'));
  await assert.rejects(store.restore(saved.backup), /файл менялся/);
  assert.equal(decode(await read(effects, 'first.ui')), source + '// новая версия');
});
test('Отказ в разрешении и смена выбранной папки не приводят к записи', async () => {
  const { root, effects, store, record } = await fixture(),
    before = await store.catalog();
  root.queryPermission = async () => 'denied';
  root.requestPermission = async () => 'denied';
  await assert.rejects(store.save([patch(before.files[0])]), /разрешения/);
  await assert.rejects(
    store.call('/api/save', { client: record.id + '-other', files: [patch(before.files[0])] }),
    /другая папка/,
  );
  assert.equal(decode(await read(effects, 'first.ui')), source);
});
test('ZIP совместим с обычной распаковкой: UTF-8, CRC32, неизменённые байты', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = encode(source),
    archive = new Uint8Array(await zip([{ path: 'effects/окно.ui', bytes }]).arrayBuffer()),
    view = new DataView(archive.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x0800);
  const nameLength = view.getUint16(26, true),
    body = archive.subarray(30 + nameLength, 30 + nameLength + bytes.length);
  assert.equal(new TextDecoder().decode(archive.subarray(30, 30 + nameLength)), 'effects/окно.ui');
  assert.equal(view.getUint32(14, true), crc32(body));
  assert.deepEqual(body, bytes);
  assert.throws(() => zip([{ path: '../escape', bytes }]), /путь/);
});
