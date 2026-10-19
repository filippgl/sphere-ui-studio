import test from 'node:test';
import {
  anchors,
  anchorText,
  placement,
  fitPlacement,
  overflow,
  resolution,
} from './layout-core.mjs';
import { scaleSfn, readSfn } from './font-core.mjs';
import { chatInfo, planChat } from './chat-core.mjs';
import {
  chatFonts,
  setChatFonts,
  originalMapScript,
  patchMapScript,
  mapScriptScales,
} from './game-core.mjs';
import {
  scaleIcon,
  isIcon,
  spriteTextures,
  prepareIcons,
  currentIconScale,
  iconStore,
} from './icons-core.mjs';
import { planHotbar, planHotbarEffects, hotbarInfo } from './hotbar-core.mjs';
import { captureScaleBase, scaleSource, isSlot, slotOffsetInserts } from './ui-core.mjs';
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
test('RGBA DDS различает размер данных и шаг строки, сохраняя прозрачность и padding', () => {
  const image = dds('', 64);
  image.writeUInt32LE(0x81007, 8);
  image.writeUInt32LE(64, 20);
  image.writeUInt32LE(32, 88);
  [0xff, 0xff00, 0xff0000, 0xff000000].forEach((mask, i) => image.writeUInt32LE(mask, 92 + i * 4));
  for (let i = 128; i < image.length; i += 4) image.set([10, 20, 30, 128], i);
  assert.deepEqual([...rgbaFromDds(image).data.slice(-4)], [10, 20, 30, 128]);
  const pitched = Buffer.concat([
    image.subarray(0, 128),
    ...Array.from({ length: 4 }, () =>
      Buffer.concat([image.subarray(128, 144), Buffer.alloc(4, 255)]),
    ),
  ]);
  pitched.writeUInt32LE(0x100f, 8);
  pitched.writeUInt32LE(20, 20);
  assert.deepEqual(rgbaFromDds(pitched).data, rgbaFromDds(image).data);
  assert.throws(() => rgbaFromDds(pitched.subarray(0, -5)), /обрезана/);
  pitched.writeUInt32LE(8, 20);
  assert.throws(() => rgbaFromDds(pitched), /шаг строки/);
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
export function sfnFixture() {
  const header = new TextEncoder().encode('SFNTfont\0font.tga\0'),
    bytes = new Uint8Array(header.length + 8 + 224 * 28);
  bytes.set(header);
  const view = new DataView(bytes.buffer),
    start = header.length;
  view.setInt32(start, 18, true);
  view.setInt32(start + 4, 13, true);
  for (let glyph = 0; glyph < 224; glyph++) {
    const offset = start + 8 + glyph * 28;
    [10, 14, -1, 12, 8, 0].forEach((n, i) => view.setInt16(offset + i * 2, n, true));
    [0.1, 0.2, 0.3, 0.4].forEach((n, i) => view.setFloat32(offset + 12 + i * 4, n, true));
  }
  return bytes;
}
test('RIGHT_Y, центр и правый край совпадают с нативными привязками; вписывание сохраняет якорь', () => {
  assert.deepEqual(anchors('RIGHT_X RIGHT_Y'), [1, 1]);
  for (const anchor of [
    [0, 0],
    [0.5, 0],
    [1, 0.5],
    [0, 1],
  ])
    assert.deepEqual(anchors(anchorText(anchor)), anchor);
  assert.equal(anchorText([0.5, 1]), 'CENTER_X | RIGHT_Y');
  assert.deepEqual(placement([800, 700], [-20, -10], 'RIGHT_X RIGHT_Y', [1920, 1080]), [1100, 370]);
  assert.deepEqual(
    fitPlacement([800, 700], [100, -500], 'RIGHT_X CENTER_Y', [1920, 1080]),
    [0, -190],
  );
  assert.equal(overflow([800, 700], [0, -190], 'RIGHT_X CENTER_Y', [1920, 1080]), false);
  assert.equal(overflow([2000, 700], [0, 0], 'RIGHT_X', [1920, 1080]), true);
  assert.deepEqual(resolution('XRES\t2580\r\nYRES\t1080'), [2580, 1080]);
  assert.equal(resolution('XRES 0\nYRES 0'), null);
});
test('SFNT масштабирует метрики всех 224 символов, сохраняя UV и исходные байты', () => {
  const before = sfnFixture(),
    result = scaleSfn(before, 2),
    a = readSfn(before),
    b = readSfn(result);
  assert.equal(a.height, 18);
  assert.equal(b.height, 36);
  assert.equal(b.baseline, 26);
  for (let glyph = 0; glyph < 224; glyph++) {
    const offset = a.start + 8 + glyph * 28;
    for (let i = 0; i < 6; i++)
      assert.equal(
        b.data.getInt16(offset + i * 2, true),
        a.data.getInt16(offset + i * 2, true) * 2,
      );
    assert.deepEqual(
      result.slice(offset + 12, offset + 28),
      before.slice(offset + 12, offset + 28),
    );
  }
  assert.throws(() => scaleSfn(before, 5), /Масштаб/);
  assert.throws(() => scaleSfn(before.slice(0, -1), 2), /структура/);
});
const chatFixture = `windowUI
{
windowName "chat_st2"
size 583 146
spritesDef
{
sprite
{
name "frame"
size 583 146
texture "atlas" 0 0 256 32 0 114 583 146
}
}
drawMethod SPRITE "frame"
control
{
classID HTCHATLISTCTRL
position 15 30
size 530 87
font 5
rowHeight 14
maxItems 256
scrollbar
{
size 16 46
rightbutton
{
position -1 45
size 18 18
}
}
}
control
{
classID HTEDIT
position 32 123
size 500 18
font 4
}
}
`;
function layoutEdits(plan) {
  return plan.map((p) => {
    if (p.insert)
      return {
        insert: 'tcoords',
        node: p.node.id,
        start: p.node.closeStart,
        end: p.node.closeStart,
        value: p.value,
      };
    const field = p.node.props.filter((f) => f.key.toLowerCase() === p.key.toLowerCase())[
      p.occurrence || 0
    ];
    return { start: field.start, end: field.end, value: p.value };
  });
}
test('Чат добавляет строки и историю, перемещая ввод и прокрутку без изменения шрифтов и номеров', () => {
  const root = parse(chatFixture).children[0],
    plan = planChat(root, { rows: 20, history: 1000 }),
    result = parse(applyEdits(chatFixture, layoutEdits(plan.edits))).children[0],
    nodes = walk(result);
  assert.equal(chatInfo(root).rows, 6);
  assert.equal(chatInfo(result).rows, 20);
  assert.equal(chatInfo(result).history, 1000);
  assert.equal(prop(result, 'size').value, '583 342');
  assert.equal(
    prop(
      nodes.find((n) => prop(n, 'classID')?.value === 'HTEDIT'),
      'position',
    ).value,
    '32 319',
  );
  assert.equal(
    prop(
      nodes.find((n) => n.kind === 'scrollbar'),
      'size',
    ).value,
    '16 242',
  );
  assert.equal(
    prop(
      nodes.find((n) => n.kind === 'rightbutton'),
      'position',
    ).value,
    '-1 241',
  );
  assert.deepEqual(
    nodes.map((n) => prop(n, 'font')?.value),
    walk(root).map((n) => prop(n, 'font')?.value),
  );
  assert.deepEqual(
    nodes.map((n) => n.id),
    walk(root).map((n) => n.id),
  );
  assert.equal(
    prop(
      nodes.find((n) => n.kind === 'sprite'),
      'texture',
    ).value,
    '"atlas" 0 0 256 32 0 310 583 342',
  );
  assert.equal(planChat(root, { rows: 80, history: 256, maxHeight: 200 }).rows, 9);
  assert.throws(() => planChat(root, { rows: 0, history: 256 }), /Строки/);
  for (const value of ['-1', '0', '1.5', '10001', 'abc']) {
    const p = prop(chatInfo(root).list, 'maxItems');
    assert.throws(
      () => applyEdits(chatFixture, [{ start: p.start, end: p.end, value }]),
      /История/,
    );
  }
});
const hotbarFixture = `windowUI
{
windowName "quick_items"
size 26 253
drawMethod SPRITE "frame"
spritesDef
{
sprite
{
name "frame"
size 26 253
texture "atlas" 205 0 231 253 0 0 26 253
}
}
control
{
classID SLOT
position 5 30
size 14 14
}
control
{
classID BUTTON
position 2 26
size 21 21
uncheckedImage "icon"
}
}
`;
test('Хоткеи меняют раскладку и UV рамки, сохраняя размеры и ориентацию иконок; вставки ограничены спрайтом', () => {
  const root = parse(hotbarFixture).children[0],
    changes = layoutEdits(planHotbar(root, true)),
    horizontalText = applyEdits(hotbarFixture, changes),
    horizontal = parse(horizontalText).children[0],
    slot = horizontal.children.find((n) => prop(n, 'classID')?.value === 'SLOT');
  assert.equal(hotbarInfo(horizontal).horizontal, true);
  assert.equal(prop(slot, 'position').value, '30 7');
  assert.equal(prop(slot, 'size').value, '14 14');
  const sprite = walk(horizontal).find((n) => n.kind === 'sprite');
  assert.equal(prop(sprite, 'texture').value, '"atlas" 205 0 231 253 0 0 253 26');
  assert.equal(prop(sprite, 'tcoords').value, '0 231 0 231 253 205 253 205 0');
  const vertical = parse(applyEdits(horizontalText, layoutEdits(planHotbar(horizontal, false))))
    .children[0];
  assert.equal(hotbarInfo(vertical).horizontal, false);
  assert.equal(
    prop(
      vertical.children.find((n) => prop(n, 'classID')?.value === 'SLOT'),
      'position',
    ).value,
    '5 30',
  );
  const inserted = changes.find((e) => e.insert);
  assert.throws(() => applyEdits(hotbarFixture, [{ ...inserted, start: 0, end: 0 }]), /вставка/);
  assert.throws(() => applyEdits(hotbarFixture, [inserted, inserted]), /вставка/);
  assert.throws(() => applyEdits(hotbarFixture, [{ ...inserted, value: '0 1 2 3' }]), /вставка/);
  assert.deepEqual(
    walk(horizontal).map((n) => n.id),
    walk(root).map((n) => n.id),
  );
});
test('Эффекты хоткеев выезжают ровно до края: у MOVE_TOP/MOVE_BOTTOM сдвиг равен пути', () => {
  const text = hotbarFixture.replace(
    'drawMethod SPRITE "frame"',
    'drawMethod SPRITE "frame"\nshowEffect MOVE_RIGHT  0.25 26\nhideEffect MOVE_LEFT   0.25 26',
  );
  const horizontalText = applyEdits(text, layoutEdits(planHotbar(parse(text).children[0], true))),
    horizontal = parse(horizontalText).children[0];
  assert.equal(prop(horizontal, 'showEffect').value, 'MOVE_TOP 0.25 26 26');
  assert.equal(prop(horizontal, 'hideEffect').value, 'MOVE_BOTTOM 0.25 26 26');
  assert.deepEqual(planHotbarEffects(horizontal), []);
  const vertical = parse(applyEdits(horizontalText, layoutEdits(planHotbar(horizontal, false))))
    .children[0];
  assert.equal(prop(vertical, 'showEffect').value, 'MOVE_RIGHT 0.25 26');
  assert.equal(prop(vertical, 'hideEffect').value, 'MOVE_LEFT 0.25 26');
  const brokenText = horizontalText
      .replace('MOVE_TOP 0.25 26 26', 'MOVE_TOP 0.25 52')
      .replace('MOVE_BOTTOM 0.25 26 26', 'ALPHA_OUT 0.25'),
    repaired = parse(
      applyEdits(brokenText, layoutEdits(planHotbarEffects(parse(brokenText).children[0]))),
    ).children[0];
  assert.equal(prop(repaired, 'showEffect').value, 'MOVE_TOP 0.25 52 52');
  assert.equal(prop(repaired, 'hideEffect').value, 'ALPHA_OUT 0.25');
});
test('Сохранённая горизонтальная рамка отражается вверх без перестановки слотов и повторного отражения', () => {
  const legacy = hotbarFixture
    .replaceAll('26 253', '253 26')
    .replace('position 5 30', 'position 30 5')
    .replace('position 2 26', 'position 26 2')
    .replace('0 0 26 253', '0 0 253 26')
    .replace(
      'texture "atlas" 205 0 231 253 0 0 253 26',
      'texture "atlas" 205 0 231 253 0 0 253 26\ntcoords 0 205 0 205 253 231 253 231 0',
    );
  const root = parse(legacy).children[0];
  const result = parse(applyEdits(legacy, layoutEdits(planHotbar(root, true)))).children[0];
  const slot = result.children.find((n) => prop(n, 'classID')?.value === 'SLOT');
  assert.equal(prop(slot, 'position').value, '30 7');
  assert.equal(prop(slot, 'size').value, '14 14');
  assert.equal(
    prop(
      walk(result).find((n) => n.kind === 'sprite'),
      'tcoords',
    ).value,
    '0 231 0 231 253 205 253 205 0',
  );
  assert.deepEqual(planHotbar(result, true), []);
});
test('Нижняя привязка вставляется только в окно и сохраняет прилегание при смене разрешения', () => {
  const root = parse(hotbarFixture).children[0];
  const insertion = {
    insert: 'alignWin',
    node: root.id,
    start: root.closeStart,
    end: root.closeStart,
    value: 'LEFT_X | RIGHT_Y',
  };
  const result = parse(applyEdits(hotbarFixture, [insertion])).children[0];
  for (const screen of [
    [1024, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const size = [506, 52],
      pos = placement(size, [0, 0], prop(result, 'alignWin').value, screen);
    assert.equal(pos[1] + size[1], screen[1]);
  }
  for (const value of ['RIGHT_Y\nwindowUI', 'RIGHT_Y | LEFT_Y', 'LEFT_X | LEFT_X'])
    assert.throws(() => applyEdits(hotbarFixture, [{ ...insertion, value }]), /вставка/);
  const sprite = walk(root).find((n) => n.kind === 'sprite');
  assert.throws(
    () =>
      applyEdits(hotbarFixture, [
        { ...insertion, node: sprite.id, start: sprite.closeStart, end: sprite.closeStart },
      ]),
    /вставка/,
  );
  assert.throws(() => applyEdits(hotbarFixture, [insertion, insertion]), /вставка/);
});
test('Исходный масштаб переживает сохранение, поворот и смену смещений без накопления', () => {
  const root = parse(hotbarFixture).children[0],
    base = captureScaleBase(root);
  const baseEdit = {
    insert: 'scaleBase',
    node: root.id,
    start: root.closeStart,
    end: root.closeStart,
    value: JSON.stringify(base),
  };
  const horizontal = applyEdits(hotbarFixture, [...layoutEdits(planHotbar(root, true)), baseEdit]);
  assert.ok(
    horizontal
      .split(/\r?\n/)
      .filter((line) => line.startsWith('// sphere-ui-studio-scale'))
      .every((line) => line.length < 200),
  );
  const reopened = parse(horizontal).children[0];
  assert.equal(prop(reopened, 'size').value, '253 26');
  assert.equal(prop(scaleSource(reopened), 'size').value, '26 253');
  assert.equal(
    walk(scaleSource(reopened))
      .flatMap((n) => n.props)
      .filter((p) => p.key === 'tcoords').length,
    0,
  );
  assert.deepEqual(reopened.scaleBase, base);
  const span = reopened.scaleBaseSpan;
  const replaced = applyEdits(horizontal, [{ ...baseEdit, start: span.start, end: span.end }]);
  assert.equal(replaced, horizontal);
  assert.equal((replaced.match(/sphere-ui-studio-scale-v1/g) || []).length, 1);
  assert.deepEqual(
    walk(reopened).map((n) => n.id),
    walk(root).map((n) => n.id),
  );
  for (const invalid of [
    { version: 9, fields: [] },
    { version: 1, fields: [{ node: 'root/999', key: 'size', occurrence: 0, value: '1 2' }] },
    { version: 1, fields: [...base.fields, base.fields[0]] },
  ])
    assert.throws(
      () => applyEdits(hotbarFixture, [{ ...baseEdit, value: JSON.stringify(invalid) }]),
      /геометрия/,
    );
  assert.throws(() => applyEdits(hotbarFixture, [{ ...baseEdit, start: 0, end: 0 }]), /масштаба/);
  assert.throws(
    () =>
      parse(
        horizontal.replace(/sphere-ui-studio-scale-v1 [^\n]+/, 'sphere-ui-studio-scale-v1 invalid'),
      ),
    /геометрия/,
  );
});
test('База масштаба сохраняет CRLF и работает в общем файле спрайтов без окна', () => {
  const text =
    'spritesDef\r\n{\r\nsprite\r\n{\r\nname "frame"\r\nsize 26 253\r\ntexture "atlas" 205 0 231 253 0 0 26 253\r\n}\r\n}';
  const root = parse(text);
  const saved = applyEdits(text, [
    {
      insert: 'scaleBase',
      node: root.id,
      start: root.closeStart,
      end: root.closeStart,
      value: JSON.stringify(captureScaleBase(root)),
    },
  ]);
  assert.ok(saved.startsWith(text + '\r\n// sphere-ui-studio-scale-v1 '));
  assert.equal(saved.replaceAll('\r\n', '').includes('\n'), false);
  const loaded = parse(saved);
  assert.equal(
    prop(
      walk(scaleSource(loaded)).find((n) => n.kind === 'sprite'),
      'size',
    ).value,
    '26 253',
  );
});
test('Ранее повреждённая масштабом рамка восстанавливается без второго поворота UV', () => {
  const broken = hotbarFixture.replace(
    'texture "atlas" 205 0 231 253 0 0 26 253',
    'texture "atlas" 205 0 231 253 0 0 26 253\ntcoords 0 231 0 231 253 205 253 205 0',
  );
  const root = parse(broken).children[0];
  const repaired = parse(applyEdits(broken, layoutEdits(planHotbar(root, true)))).children[0];
  const frame = walk(repaired).find((n) => n.kind === 'sprite');
  assert.equal(prop(frame, 'tcoords').value, '0 231 0 231 253 205 253 205 0');
  assert.equal(prop(frame, 'size').value, '253 26');
  const vertical = parse(applyEdits(broken, layoutEdits(planHotbar(root, false)))).children[0];
  assert.equal(prop(vertical, 'size').value, '26 253');
  assert.equal(
    prop(
      walk(vertical).find((n) => n.kind === 'sprite'),
      'tcoords',
    ).value,
    '0 205 0 231 0 231 253 205 253',
  );
  assert.equal(
    prop(
      vertical.children.find((n) => prop(n, 'classID')?.value === 'SLOT'),
      'position',
    ).value,
    '5 30',
  );
});

test('Шрифты чата в config.cfg меняются на месте, а скрипт карты обратимо собирается по рецепту', async () => {
  const cfg = 'XRES\t1920\r\nCHAT_LIST_FONT\t4\r\n';
  assert.deepEqual(chatFonts(cfg), { list: 4, edit: 4 });
  assert.equal(chatFonts('CHAT_LIST_FONT 1').list, 4);
  const changed = setChatFonts(cfg, { list: 16, edit: 17 });
  assert.match(changed, /^CHAT_LIST_FONT\t16\r$/m);
  assert.match(changed, /^CHAT_EDIT_FONT\t17\r$/m);
  assert.throws(() => setChatFonts(cfg, { list: 99, edit: 4 }), /шрифт/);
  // A synthetic script: the recipe copies [0, 5), replaces "ab" with code holding two params.
  const source = encode('head-ab-tail'),
    hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''),
    recipe = {
      script: 'st_map.mbc',
      sourceSha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', source))),
      resultSize: 5 + 8 + 5,
      params: { minimap: 5, bigmap: 9 },
      ops: [[0, 5], { from: hex(encode('ab')), to: '0000000000000000' }, [7, 5]],
    };
  assert.equal(await patchMapScript(source, { minimap: 1, bigmap: 1 }, recipe), source);
  const patched = await patchMapScript(source, { minimap: 1.75, bigmap: 1.5 }, recipe);
  assert.equal(patched.length, recipe.resultSize);
  assert.deepEqual(await mapScriptScales(patched, recipe), { minimap: 1.75, bigmap: 1.5 });
  assert.deepEqual([...(await originalMapScript(patched, recipe))], [...source]);
  assert.deepEqual(await mapScriptScales(source, recipe), { minimap: 1, bigmap: 1 });
  assert.equal(await mapScriptScales(encode('другой скрипт'), recipe), null);
});
test('Иконки предметов увеличиваются от оригиналов и возвращаются к ним при 100%', async () => {
  const dds = (size) => {
      const bytes = new Uint8Array(128 + size * size * 4).fill(200, 128),
        view = new DataView(bytes.buffer);
      bytes.set([68, 68, 83, 32]);
      for (const [offset, value] of [
        [4, 124],
        [8, 0x100f],
        [12, size],
        [16, size],
        [20, size * 4],
        [76, 32],
        [80, 0x41],
        [88, 32],
        [92, 0xff0000],
        [96, 0xff00],
        [100, 0xff],
        [104, 0xff000000],
      ])
        view.setUint32(offset, value, true);
      return bytes;
    },
    icon = dds(32),
    files = new Map([
      ['textures/ar_ring.dds', icon],
      ['textures/frame.dds', icon],
      ['textures/big.dds', dds(64)],
    ]),
    io = {
      read: async (scope, name) => files.get(`${scope}/${name}`) ?? null,
      list: async (scope) =>
        [...files.keys()].filter((k) => k.startsWith(scope + '/')).map((k) => k.split('/')[1]),
      uiTexts: ['sprite\n{\n texture "frame" 0 0 32 32 0 0 32 32\n}'],
    },
    apply = (assets) => assets.forEach((a) => files.set(`${a.scope}/${a.name}`, a.after));
  assert.equal(isIcon(icon), true);
  assert.equal(isIcon(files.get('textures/big.dds')), false);
  assert.deepEqual([...spriteTextures(io.uiTexts)], ['frame']);
  assert.equal(await currentIconScale(io.read), 1);
  apply((await prepareIcons(1.5, io)).assets);
  assert.equal(await currentIconScale(io.read), 1.5);
  assert.equal(rgbaFromDds(files.get('textures/ar_ring.dds')).width, 48);
  assert.equal(rgbaFromDds(files.get('textures/frame.dds')).width, 32);
  assert.equal(files.get(`${iconStore}/ar_ring.dds`), icon);
  apply((await prepareIcons(2, io)).assets);
  assert.equal(rgbaFromDds(files.get('textures/ar_ring.dds')).width, 64);
  apply((await prepareIcons(1, io)).assets);
  assert.equal(files.get('textures/ar_ring.dds'), icon);
  assert.equal(await currentIconScale(io.read), 1);
});
test('Слоты без textofs получают масштабированное смещение числа, а исходный масштаб помнит умолчание', () => {
  const text =
    'windowUI\r\n{\r\n  windowName "bag"\r\n  size 205 152\r\n  control\r\n  {\r\n    classID LISTITEM\r\n    size 155 108\r\n    itemTemplate\r\n    {\r\n      size 150 36\r\n      control\r\n      {\r\n\t classID    SLOT\r\n\t size\t    36 35\r\n      }\r\n      control\r\n      {\r\n\t classID SLOT\r\n\t size 36 35\r\n\t textofs -4 1\r\n      }\r\n    }\r\n  }\r\n}\r\n';
  const root = parse(text).children[0],
    [list, , plain, explicit] = walk(root).slice(1);
  const inserts = slotOffsetInserts(root, 1.5);
  assert.deepEqual(
    inserts.map((e) => [e.node, e.value]),
    [[plain.id, '-3 3']],
  );
  assert.deepEqual(
    slotOffsetInserts(root, 1).map((e) => e.value),
    ['-2 2'],
  );
  const baseEdit = {
    insert: 'scaleBase',
    node: root.id,
    start: root.closeStart,
    end: root.closeStart,
    value: JSON.stringify(captureScaleBase(root)),
  };
  const saved = applyEdits(text, [...inserts, baseEdit]);
  assert.ok(saved.includes('\t size\t    36 35\r\n\t textofs -3 3\r\n      }'));
  assert.equal(saved.replaceAll('\r\n', '').includes('\n'), false);
  const reopened = parse(saved).children[0],
    slots = walk(reopened).filter(isSlot);
  assert.deepEqual(
    slots.map((n) => prop(n, 'textofs').value),
    ['-3 3', '-4 1'],
  );
  // The next scale starts from the client default, not from the already scaled value.
  assert.deepEqual(
    walk(scaleSource(reopened))
      .filter(isSlot)
      .map((n) => prop(n, 'textofs').value),
    ['-2 2', '-4 1'],
  );
  assert.deepEqual(slotOffsetInserts(reopened, 2), []);
  const [insert] = inserts;
  for (const invalid of [
    { ...insert, node: list.id, start: list.closeStart, end: list.closeStart },
    { ...insert, node: explicit.id, start: explicit.closeStart, end: explicit.closeStart },
    { ...insert, start: 0, end: 0 },
    { ...insert, value: '-3 3 3' },
    { ...insert, value: '-3\r\ncontrol' },
  ])
    assert.throws(() => applyEdits(text, [invalid]), /слоте/);
  assert.throws(() => applyEdits(text, [insert, insert]), /слоте/);
});
