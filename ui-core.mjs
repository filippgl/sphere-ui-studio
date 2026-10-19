const decoder = new TextDecoder('windows-1251');
const alphabet = new Map(
  Array.from({ length: 256 }, (_, i) => [decoder.decode(Uint8Array.of(i)), i]),
);
export const decode = (bytes) => decoder.decode(bytes);
export function encode(text) {
  return Uint8Array.from(
    [...text].map((ch) => {
      if (!alphabet.has(ch)) throw Error(`Символ «${ch}» отсутствует в кодировке клиента`);
      return alphabet.get(ch);
    }),
  );
}

// Original geometry travels with the UI file, so saving/reopening does not redefine 100%.
// The client ignores this comment; ordinary fields and element IDs remain native.
const scaleMarker = '// sphere-ui-studio-scale-v1 ';
const scaleContinuation = '// sphere-ui-studio-scale+ ';
export const scaleFields = new Set([
  'position',
  'size',
  'recttitle',
  'font',
  'textofs',
  'slotpicofs',
  'imageoffset',
  'cursoroffset',
  'statuspos',
  'visibletextmargin',
  'listitemtextmargin',
  'titletextmargin',
  'selectionborder',
  'rowheight',
  'scrollspr',
  'texture',
  'tcoords',
  'showeffect',
  'hideeffect',
]);
export function captureScaleBase(node) {
  return {
    version: 1,
    fields: walk(node).flatMap((n) => {
      const counts = new Map();
      return n.props
        .filter((p) => scaleFields.has(p.key.toLowerCase()))
        .map((p) => {
          const key = p.key.toLowerCase(),
            occurrence = counts.get(key) || 0;
          counts.set(key, occurrence + 1);
          return { node: n.id, key, occurrence, value: p.value };
        });
    }),
  };
}
export function validateScaleBase(base, node) {
  if (base?.version !== 1 || !Array.isArray(base.fields) || base.fields.length > 10000)
    throw Error('Повреждена исходная геометрия масштаба');
  const nodes = new Map(walk(node).map((n) => [n.id, n])),
    seen = new Set();
  for (const f of base.fields) {
    const key = `${f.node}:${f.key}:${f.occurrence}`;
    const n = nodes.get(f.node);
    if (
      !n ||
      !scaleFields.has(f.key) ||
      !Number.isInteger(f.occurrence) ||
      f.occurrence < 0 ||
      typeof f.value !== 'string' ||
      f.value.length > 1024 ||
      /[\r\n{}]|\/\//.test(f.value) ||
      !n.props.some((p) => p.key.toLowerCase() === f.key) ||
      seen.has(key)
    )
      throw Error('Повреждена исходная геометрия масштаба');
    seen.add(key);
  }
  return base;
}
export function scaleSource(node) {
  if (!node.scaleBase) return node;
  const base = validateScaleBase(node.scaleBase, node),
    result = structuredClone(node);
  const fields = new Map(base.fields.map((f) => [`${f.node}:${f.key}:${f.occurrence}`, f.value]));
  for (const n of walk(result)) {
    const counts = new Map();
    n.props = n.props.filter((p) => {
      const key = p.key.toLowerCase(),
        occurrence = counts.get(key) || 0;
      counts.set(key, occurrence + 1);
      const value = fields.get(`${n.id}:${key}:${occurrence}`);
      if (value !== undefined) p.value = value;
      // A count offset written by a scale stands for the client default of the original.
      else if (key === 'textofs' && isSlot(n)) p.value = slotTextOffset;
      // A later rotation may have added UVs; their absence in the original matters too.
      return key !== 'tcoords' || value !== undefined;
    });
  }
  return result;
}

// SlotCtrl (FUN_004c9040) draws the stack count at textofs -2 2 from the top right corner when
// the .ui has no textofs. The count font keeps its size while the slot frame grows, so a scaled
// slot needs this offset written out and scaled like an explicit one, or the frame covers digits.
export const slotTextOffset = '-2 2';
export const isSlot = (node) =>
  node.kind === 'control' && value(node, 'classID').trim().toUpperCase() === 'SLOT';
// Inserts for slots without textofs; `from` gives the offset to scale (the default by default).
export function slotOffsetInserts(root, factor, from = () => slotTextOffset) {
  return walk(root)
    .filter((n) => isSlot(n) && !prop(n, 'textofs'))
    .map((n) => ({
      insert: 'textofs',
      key: 'textofs',
      node: n.id,
      start: n.closeStart,
      end: n.closeStart,
      value: from(n)
        .trim()
        .split(/\s+/)
        .map((x) => Math.round(Number(x) * factor))
        .join(' '),
    }));
}

export function parse(text) {
  const root = { kind: 'root', id: 'root', props: [], children: [] };
  const stack = [root];
  let pending = null;
  let offset = 0;
  const masked = text.replace(/\/\*[\s\S]*?\*\//g, (part) => part.replace(/[^\r\n]/g, ' '));
  for (const raw of masked.split(/(?<=\n)/)) {
    if (raw.trimStart().startsWith(scaleMarker)) {
      const node = stack.at(-1);
      if (node.scaleEncoded !== undefined || !['root', 'windowUI'].includes(node.kind))
        throw Error('Повторная исходная геометрия масштаба');
      node.scaleEncoded = raw.trim().slice(scaleMarker.length);
      node.scaleBaseSpan = { start: offset, end: offset + raw.length };
    } else if (raw.trimStart().startsWith(scaleContinuation)) {
      const node = stack.at(-1);
      if (node.scaleEncoded === undefined || node.scaleBaseSpan.end !== offset)
        throw Error('Повреждена исходная геометрия масштаба');
      node.scaleEncoded += raw.trim().slice(scaleContinuation.length);
      node.scaleBaseSpan.end = offset + raw.length;
    }
    // Quoted text can contain slashes; comments only start outside a string
    let quoted = false,
      end = raw.length;
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i] === '"' && raw[i - 1] !== '\\') quoted = !quoted;
      if (!quoted && raw.slice(i, i + 2) === '//') {
        end = i;
        break;
      }
    }
    const code = raw.slice(0, end).trim();
    if (code === '{') {
      if (!pending)
        throw Error(`Неизвестный блок в строке ${text.slice(0, offset).split('\n').length}`);
      const parent = stack.at(-1);
      const node = {
        kind: pending,
        id: `${parent.id}/${parent.children.length}`,
        props: [],
        children: [],
        start: offset,
      };
      parent.children.push(node);
      stack.push(node);
      pending = null;
    } else if (code === '}') {
      if (stack.length === 1) throw Error('Лишняя закрывающая скобка');
      const node = stack.pop();
      node.closeStart = offset;
      node.end = offset + raw.length;
      pending = null;
    } else if (code) {
      const match = code.match(/^(\w+)\s+(\S.*)$/);
      if (match) {
        const start = offset + raw.indexOf(match[2], raw.indexOf(match[1]) + match[1].length);
        stack
          .at(-1)
          .props.push({ key: match[1], value: match[2], start, end: start + match[2].length });
        pending = null;
      } else pending = code;
    }
    offset += raw.length;
  }
  if (stack.length !== 1) throw Error('Незакрытый блок');
  root.end = root.closeStart = text.length;
  for (const node of walk(root))
    if (node.scaleEncoded !== undefined) {
      try {
        if (node.scaleEncoded.length > 1000000) throw Error('Слишком большая исходная геометрия');
        node.scaleBase = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(node.scaleEncoded), (c) => c.charCodeAt(0)),
          ),
        );
      } catch {
        throw Error('Повреждена исходная геометрия масштаба');
      }
      delete node.scaleEncoded;
      validateScaleBase(node.scaleBase, node);
    }
  return root;
}
export function walk(node) {
  return [node, ...node.children.flatMap(walk)];
}
export const prop = (node, key) =>
  node.props.find((p) => p.key.toLowerCase() === key.toLowerCase());
export const value = (node, key, fallback = '') => prop(node, key)?.value ?? fallback;
export const unquote = (text) => text.replace(/^"|"$/g, '');
export function insertionPoint(text, node) {
  const end = node.end - (text[node.end - 1] === '\n' ? 1 : 0);
  return text.lastIndexOf('\n', end - 1) + 1;
}

export const editable = new Set(
  [
    'position',
    'size',
    'rectTitle',
    'font',
    'textcolor',
    'focuscolor',
    'disabledcolor',
    'backcolor',
    'alignWin',
    'textFormat',
    'drawMethod',
    'windowText',
    'showEffect',
    'hideEffect',
    'escapeHandle',
    'canNotCross',
    'hitTransparent',
    'texture',
    'tcoords',
    'textofs',
    'slotpicofs',
    'imageoffset',
    'cursoroffset',
    'statuspos',
    'visibletextmargin',
    'listitemtextmargin',
    'titletextmargin',
    'selectionborder',
    'rowheight',
    'maxitems',
    'scrollspr',
  ].map((x) => x.toLowerCase()),
);
export function applyEdits(text, edits) {
  const fields = new Map(
    walk(parse(text))
      .flatMap((n) => n.props)
      .map((p) => [`${p.start}:${p.end}`, p]),
  );
  const seen = new Set();
  const insertions = new Map();
  for (const edit of edits) {
    if (edit.insert) {
      const node = walk(parse(text)).find((n) => n.id === edit.node),
        nums = typeof edit.value === 'string' ? edit.value.trim().split(/\s+/).map(Number) : [];
      if (edit.insert === 'scaleBase') {
        const key = `${edit.node}:scaleBase`,
          span = node?.scaleBaseSpan;
        const start = span?.start ?? node?.closeStart,
          end = span?.end ?? start;
        if (
          !node ||
          !['root', 'windowUI'].includes(node.kind) ||
          edit.start !== start ||
          edit.end !== end ||
          typeof edit.value !== 'string' ||
          edit.value.length > 700000 ||
          seen.has(key)
        )
          throw Error('Недопустимая запись исходного масштаба');
        const base = validateScaleBase(JSON.parse(edit.value), node);
        const bytes = new TextEncoder().encode(JSON.stringify(base));
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const newline = text.includes('\r\n') ? '\r\n' : '\n';
        insertions.set(
          edit,
          (start > 0 && text[start - 1] !== '\n' ? newline : '') +
            btoa(binary)
              .match(/.{1,160}/g)
              .map((chunk, i) => (i ? scaleContinuation : scaleMarker) + chunk)
              .join(newline) +
            newline,
        );
        seen.add(key);
        continue;
      }
      if (edit.insert === 'alignWin') {
        const key = `${edit.node}:alignWin`;
        if (
          node?.kind !== 'windowUI' ||
          edit.start !== edit.end ||
          edit.start !== insertionPoint(text, node) ||
          typeof edit.value !== 'string' ||
          !/^(LEFT_X|CENTER_X|RIGHT_X)\s*\|\s*(LEFT_Y|CENTER_Y|RIGHT_Y)$/.test(edit.value) ||
          node.props.some((p) => p.key.toLowerCase() === 'alignwin') ||
          seen.has(key)
        )
          throw Error('Недопустимая вставка привязки окна');
        seen.add(key);
        insertions.set(edit, `    alignWin ${edit.value}${text.includes('\r\n') ? '\r\n' : '\n'}`);
        continue;
      }
      if (edit.insert === 'textofs') {
        const key = `${edit.node}:textofs`;
        if (
          !node ||
          !isSlot(node) ||
          prop(node, 'textofs') ||
          edit.start !== edit.end ||
          edit.start !== insertionPoint(text, node) ||
          typeof edit.value !== 'string' ||
          !/^-?\d+ -?\d+$/.test(edit.value) ||
          nums.some((n) => Math.abs(n) > 32768) ||
          seen.has(key)
        )
          throw Error('Недопустимая вставка смещения числа в слоте');
        seen.add(key);
        // Same indentation as the slot's own fields.
        const first = node.props[0]?.start ?? edit.start,
          indent = text.slice(text.lastIndexOf('\n', first - 1) + 1, first).match(/^[ \t]*/)[0];
        insertions.set(
          edit,
          `${indent}textofs ${edit.value}${text.includes('\r\n') ? '\r\n' : '\n'}`,
        );
        continue;
      }
      const index = nums[0],
        key = `${edit.node}:tcoords:${index}`;
      if (
        edit.insert !== 'tcoords' ||
        node?.kind !== 'sprite' ||
        edit.start !== edit.end ||
        edit.start !== insertionPoint(text, node) ||
        nums.length !== 9 ||
        nums.some((n) => !Number.isInteger(n) || Math.abs(n) > 32768) ||
        index < 0 ||
        index >= node.props.filter((p) => p.key.toLowerCase() === 'texture').length ||
        node.props.some(
          (p) => p.key.toLowerCase() === 'tcoords' && Number(p.value.split(/\s+/)[0]) === index,
        ) ||
        seen.has(key)
      )
        throw Error('Недопустимая вставка координат рамки');
      seen.add(key);
      insertions.set(
        edit,
        `        tcoords ${nums.join(' ')}${text.includes('\r\n') ? '\r\n' : '\n'}`,
      );
      continue;
    }
    const key = `${edit.start}:${edit.end}`,
      field = fields.get(key);
    if (!field || seen.has(key) || !editable.has(field.key.toLowerCase()))
      throw Error('Неизвестное или повторное поле');
    seen.add(key);
    const lower = field.key.toLowerCase();
    if (
      ['maxitems', 'rowheight'].includes(lower) &&
      (!/^\d+$/.test(edit.value) ||
        Number(edit.value) < 1 ||
        Number(edit.value) > (lower === 'maxitems' ? 10000 : 512))
    )
      throw Error(
        lower === 'maxitems' ? 'История: 1–10000 сообщений' : 'Высота строки: 1–512 пикселей',
      );
    if (
      typeof edit.value !== 'string' ||
      edit.value.length > 1024 ||
      /[\r\n{}]|\/\//.test(edit.value)
    )
      throw Error('Недопустимое значение поля');
    if ((edit.value.match(/(?<!\\)"/g)?.length || 0) % 2) throw Error('Незакрытая строка');
    if (
      [
        'position',
        'size',
        'rectTitle',
        'font',
        'textcolor',
        'focuscolor',
        'disabledcolor',
        'backcolor',
      ].includes(field.key)
    ) {
      const nums = edit.value.trim().split(/\s+/).map(Number);
      const expected = field.value.trim().split(/\s+/).length;
      if (nums.length !== expected || nums.some((n) => !Number.isInteger(n) || Math.abs(n) > 32768))
        throw Error(`Недопустимые числа: ${field.key}`);
      if (field.key.toLowerCase().includes('color') && nums.some((n) => n < 0 || n > 255))
        throw Error('Цвет: от 0 до 255');
      if (field.key === 'size' && nums.some((n) => n < 1))
        throw Error('Размер должен быть положительным');
      if (field.key === 'font' && (nums[0] < 0 || nums[0] > 63))
        throw Error('Неизвестный номер шрифта');
    }
  }
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    result =
      result.slice(0, edit.start) + (insertions.get(edit) ?? edit.value) + result.slice(edit.end);
  parse(result);
  return result;
}
