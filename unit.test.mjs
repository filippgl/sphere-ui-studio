import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { decode, encode, parse, walk, prop, applyEdits } from './ui-model.mjs';
import { rgbaFromDds, png } from './dds.mjs';

const source =
  '// комментарий\r\nwindowUI\r\n{\r\n  windowName "demo"\r\n  size 200 100\r\n  /* position 999 999 */\r\n  control\r\n  {\r\n    classID TEXT\r\n    position 10 20\r\n    size 80 16\r\n    windowText "Текст // внутри строки"\r\n  }\r\n}\r\n';

test('Редактирование сохраняет Windows-1251, комментарии и CRLF вокруг выбранного поля', () => {
  const bytes = encode(source);
  assert.equal(decode(bytes), source);
  const model = parse(source),
    field = prop(model.children[0], 'size');
  const changed = applyEdits(source, [{ start: field.start, end: field.end, value: '320 180' }]);
  assert.deepEqual(encode(changed).subarray(0, field.start), bytes.subarray(0, field.start));
  assert.equal(changed.slice(field.start + 7), source.slice(field.end));
  assert.equal(prop(parse(changed).children[0], 'size').value, '320 180');
});

test('Закомментированные поля не попадают в AST, слеши внутри текста сохраняются', () => {
  const nodes = walk(parse(source));
  assert.equal(nodes.filter((n) => n.kind === 'control').length, 1);
  assert.equal(
    prop(
      nodes.find((n) => n.kind === 'control'),
      'windowText',
    ).value,
    '"Текст // внутри строки"',
  );
  assert.equal(
    prop(
      nodes.find((n) => n.kind === 'windowUI'),
      'position',
    ),
    undefined,
  );
  for (const n of nodes)
    for (const p of n.props) assert.equal(source.slice(p.start, p.end), p.value);
});

test('Сохранение отклоняет повторные поля, неверные размеры и внедрение новых блоков', () => {
  const field = prop(parse(source).children[0], 'size');
  const patch = (value) => ({ start: field.start, end: field.end, value });
  for (const value of ['0 16', '-1 16', '40000 16', '20 30\ncontrol', '20 30 }', '1 2 // comment'])
    assert.throws(() => applyEdits(source, [patch(value)]));
  assert.throws(() => applyEdits(source, [patch('20 30'), patch('40 50')]));
  assert.throws(() =>
    applyEdits(source, [{ start: field.start + 1, end: field.end, value: '20 30' }]),
  );
  const name = prop(parse(source).children[0], 'windowName');
  assert.throws(() => applyEdits(source, [{ start: name.start, end: name.end, value: '"new"' }]));
  assert.throws(() => encode('🙂'));
});

test('После изменения размера сохраняются стабильные номера элементов', () => {
  const before = parse(source),
    size = prop(before.children[0], 'size');
  const after = parse(
    applyEdits(source, [{ start: size.start, end: size.end, value: '1024 768' }]),
  );
  assert.deepEqual(
    walk(after).map((n) => [n.kind, n.id]),
    walk(before).map((n) => [n.kind, n.id]),
  );
});

function dds(format, bytes) {
  const buffer = Buffer.alloc(128 + bytes);
  buffer.write('DDS ');
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(4, 12);
  buffer.writeUInt32LE(4, 16);
  buffer.write(format, 84);
  return buffer;
}
test('DXT1 декодирует красный блок, прозрачный цвет и обрезанный файл', () => {
  const block = dds('DXT1', 8);
  block.writeUInt16LE(0xf800, 128);
  const image = rgbaFromDds(block);
  assert.deepEqual([...image.data.subarray(0, 4)], [255, 0, 0, 255]);
  block.writeUInt16LE(0, 128);
  block.writeUInt16LE(0xffff, 130);
  block.writeUInt32LE(0xffffffff, 132);
  assert.deepEqual([...rgbaFromDds(block).data.subarray(0, 4)], [0, 0, 0, 0]);
  assert.throws(() => rgbaFromDds(block.subarray(0, 134)), /обрезана/);
});
test('DXT3 и DXT5 сохраняют альфа-канал', () => {
  const dxt3 = dds('DXT3', 16);
  dxt3.fill(0x88, 128, 136);
  dxt3.writeUInt16LE(0x07e0, 136);
  assert.deepEqual([...rgbaFromDds(dxt3).data.subarray(0, 4)], [0, 255, 0, 136]);
  const dxt5 = dds('DXT5', 16);
  dxt5[128] = 200;
  dxt5[129] = 0;
  dxt5.writeUInt16LE(0x001f, 136);
  assert.deepEqual([...rgbaFromDds(dxt5).data.subarray(0, 4)], [0, 0, 255, 200]);
});
test('PNG содержит исходный пиксель после распаковки IDAT', () => {
  const bytes = png({ width: 1, height: 1, data: Buffer.from([10, 20, 30, 128]) });
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  let offset = 8;
  const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.deepEqual([...inflateSync(Buffer.concat(chunks))], [0, 10, 20, 30, 128]);
});
