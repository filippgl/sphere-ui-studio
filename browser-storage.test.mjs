import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStorage, sha256 } from './browser-storage.mjs';
import { UploadedDirectory, child, read, write } from './browser-files.mjs';
import { encode, decode, prop } from './ui-core.mjs';
import { zip, crc32 } from './zip.mjs';
import { readSfn } from './font-core.mjs';

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
test('Повреждённая копия блокирует откат; внешние изменения сохраняются отдельной точкой перед восстановлением', async () => {
  const { root, effects, store } = await fixture(),
    before = await store.catalog();
  const saved = await store.save([patch(before.files[0])]);
  const dir = await child(await child(root, '_interface-editor-backups'), saved.backup);
  await write(dir, 'first.ui', encode('Повреждено'));
  await assert.rejects(store.restore(saved.backup), /повреждена/);
  await write(dir, 'first.ui', encode(source));
  await write(effects, 'first.ui', encode(source + '// новая версия'));
  const restored = await store.restore(saved.backup);
  assert.equal(decode(await read(effects, 'first.ui')), source);
  const checkpoint = await child(await child(root, '_interface-editor-backups'), restored.backup);
  assert.equal(decode(await read(checkpoint, 'first.ui')), source + '// новая версия');
  await store.restore(restored.backup);
  assert.equal(decode(await read(effects, 'first.ui')), source + '// новая версия');
});
test('Выбор старой копии откатывает все последующие файлы; возврат к состоянию до отката восстанавливает их точно', async () => {
  const { effects, store } = await fixture();
  let files = (await store.catalog()).files;
  const first = await store.save([
    patch(
      files.find((f) => f.name === 'first.ui'),
      '300 150',
    ),
  ]);
  files = (await store.catalog()).files;
  await store.save([
    patch(
      files.find((f) => f.name === 'second.ui'),
      '400 200',
    ),
  ]);
  files = (await store.catalog()).files;
  await store.save([
    patch(
      files.find((f) => f.name === 'first.ui'),
      '600 300',
    ),
  ]);
  const before = await read(effects, 'first.ui'),
    secondBefore = await read(effects, 'second.ui');
  const history = await store.call('/api/history');
  assert.equal(history.at(-1).revisions, 3);
  assert.deepEqual(
    history
      .at(-1)
      .files.map((f) => f.name)
      .sort(),
    ['first.ui', 'second.ui'],
  );
  const restored = await store.restore(first.backup);
  assert.equal(restored.revisions.length, 3);
  assert.equal(decode(await read(effects, 'first.ui')), source);
  assert.equal(decode(await read(effects, 'second.ui')), source);
  assert.equal((await store.call('/api/history'))[0].kind, 'restore');
  await store.restore(restored.backup);
  assert.deepEqual(await read(effects, 'first.ui'), before);
  assert.deepEqual(await read(effects, 'second.ui'), secondBefore);
});
test('Ошибка в середине отката старой ревизии возвращает все записанные файлы к текущему состоянию', async () => {
  const { effects, store } = await fixture();
  const files = (await store.catalog()).files;
  const saved = await store.save(files.map((f) => patch(f)));
  const before = await read(effects, 'first.ui');
  const target = await child(effects, 'second.ui', 'file');
  target.createWritable = async () => {
    throw Error('Запись запрещена');
  };
  await assert.rejects(store.restore(saved.backup), /Запись запрещена/);
  assert.deepEqual(await read(effects, 'first.ui'), before);
  assert.deepEqual(await store.backups(), [saved.backup]);
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
async function fontFixture() {
  const result = await fixture(),
    header = new TextEncoder().encode('SFNTfont\0font.tga\0'),
    bytes = new Uint8Array(header.length + 8 + 224 * 28),
    view = new DataView(bytes.buffer);
  bytes.set(header);
  view.setInt32(header.length, 18, true);
  view.setInt32(header.length + 4, 13, true);
  for (let i = 0; i < 224; i++) view.setInt16(header.length + 8 + i * 28, 10, true);
  const xadd = await child(result.root, 'xadd', 'directory', true);
  for (const suffix of ['', '_d']) {
    await write(result.effects, 'font' + suffix + '.sfn', bytes);
    await write(xadd, 'font' + suffix + '.dds', new Uint8Array([1, 2, 3]));
  }
  return { ...result, xadd, bytes };
}
test('Увеличенный шрифт, языковые варианты и fonts.cfg сохраняются и откатываются одной операцией', async () => {
  const { root, effects, xadd, store, bytes } = await fontFixture(),
    catalog = await store.catalog(),
    file = catalog.files[0],
    font = prop(file.tree.children[0], 'font'),
    cfgBefore = await read(root, 'fonts.cfg'),
    edits = [{ start: font.start, end: font.end, value: '4' }];
  await assert.rejects(
    store.save([{ ...file, edits }], [{ id: 4, sourceId: 3, factor: 1.5 }], 'wrong'),
    /fonts.cfg/,
  );
  const result = await store.save(
    [{ ...file, edits }],
    [{ id: 4, sourceId: 3, factor: 1.5 }],
    catalog.fontsHash,
  );
  assert.equal(readSfn(await read(effects, 'studio_f3_1500.sfn')).height, 27);
  assert.equal(readSfn(await read(effects, 'studio_f3_1500_d.sfn')).height, 27);
  assert.deepEqual(await read(xadd, 'studio_f3_1500.dds'), new Uint8Array([1, 2, 3]));
  assert.match(decode(await read(root, 'fonts.cfg')), /NEW_FONTS_NUMBER 3/);
  assert.equal(result.fonts.at(-1).id, 4);
  assert.deepEqual(await read(effects, 'font.sfn'), bytes);
  const dir = await child(await child(root, '_interface-editor-backups'), result.backup);
  assert.deepEqual(await read(dir, 'root--fonts.cfg'), cfgBefore);
  await store.restore(result.backup);
  assert.deepEqual(await read(root, 'fonts.cfg'), cfgBefore);
  assert.equal(decode(await read(effects, file.name)), source);
  await assert.rejects(read(effects, 'studio_f3_1500.sfn'), { name: 'NotFoundError' });
  await assert.rejects(read(xadd, 'studio_f3_1500_d.dds'), { name: 'NotFoundError' });
});
test('Ошибка записи UI откатывает конфигурацию и созданные шрифты; чужие файлы не заменяются', async () => {
  const { root, effects, store } = await fontFixture(),
    catalog = await store.catalog(),
    file = catalog.files[0],
    font = prop(file.tree.children[0], 'font'),
    edits = [{ start: font.start, end: font.end, value: '4' }],
    plans = [{ id: 4, sourceId: 3, factor: 1.5 }],
    cfgBefore = await read(root, 'fonts.cfg');
  const target = await child(effects, file.name, 'file');
  target.createWritable = async () => {
    throw Error('Запись UI запрещена');
  };
  await assert.rejects(
    store.save([{ ...file, edits }], plans, catalog.fontsHash),
    /Запись UI запрещена/,
  );
  assert.deepEqual(await read(root, 'fonts.cfg'), cfgBefore);
  await assert.rejects(read(effects, 'studio_f3_1500.sfn'), { name: 'NotFoundError' });
  assert.deepEqual(await store.backups(), []);
  await write(effects, 'studio_f3_1500.sfn', new Uint8Array([99]));
  await assert.rejects(
    store.save([{ ...file, edits }], plans, catalog.fontsHash),
    /уже существует/,
  );
  assert.deepEqual(await read(effects, 'studio_f3_1500.sfn'), new Uint8Array([99]));
});
