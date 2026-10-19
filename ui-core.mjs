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

export function parse(text) {
  const root = { kind: 'root', id: 'root', props: [], children: [] };
  const stack = [root];
  let pending = null;
  let offset = 0;
  const masked = text.replace(/\/\*[\s\S]*?\*\//g, (part) => part.replace(/[^\r\n]/g, ' '));
  for (const raw of masked.split(/(?<=\n)/)) {
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
      stack.pop().end = offset + raw.length;
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
  return root;
}
export function walk(node) {
  return [node, ...node.children.flatMap(walk)];
}
export const prop = (node, key) =>
  node.props.find((p) => p.key.toLowerCase() === key.toLowerCase());
export const value = (node, key, fallback = '') => prop(node, key)?.value ?? fallback;
export const unquote = (text) => text.replace(/^"|"$/g, '');

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
  for (const edit of edits) {
    const key = `${edit.start}:${edit.end}`,
      field = fields.get(key);
    if (!field || seen.has(key) || !editable.has(field.key.toLowerCase()))
      throw Error('Неизвестное или повторное поле');
    seen.add(key);
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
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  parse(result);
  return result;
}
