import { prop, walk, unquote } from './ui-core.mjs';
const rawValue = (node, key, fallback = '', occurrence = 0) =>
  node.props.filter((p) => p.key.toLowerCase() === key.toLowerCase())[occurrence]?.value ??
  fallback;

const pair = (node, key, read) => read(node, key, '0 0').trim().split(/\s+/).map(Number);
export function chatInfo(root, read = rawValue, fonts = []) {
  const name = unquote(read(root, 'windowName'));
  if (!['chat', 'chat_st2', 'chat_sys'].includes(name)) return null;
  const list = root.children.find(
    (n) => n.kind === 'control' && /^(?:TEXTLIST|HTCHATLISTCTRL)$/i.test(read(n, 'classID')),
  );
  if (!list) return null;
  const font = Number(read(list, 'font', read(root, 'font', '4'))),
    rowHeight =
      Number(read(list, 'rowHeight', '0')) ||
      fonts.find((f) => f.id === font)?.height ||
      (font === 2 ? 11 : 15),
    size = pair(list, 'size', read),
    history = Number(read(list, 'maxItems', '256'));
  return {
    name,
    list,
    rowHeight,
    rows: Math.max(1, Math.floor(size[1] / rowHeight)),
    history,
    size,
  };
}

// Grow the text area, scroll track and lower toolbar without magnifying text or icons.
export function planChat(root, { rows, history, maxHeight = 16384 }, read = rawValue, fonts = []) {
  const info = chatInfo(root, read, fonts);
  if (!info || !prop(info.list, 'maxItems'))
    throw Error('В этом окне нет поддерживаемого списка сообщений');
  if (
    !Number.isInteger(rows) ||
    rows < 2 ||
    rows > 80 ||
    !Number.isInteger(history) ||
    history < 2 ||
    history > 10000
  )
    throw Error('Строки: 2–80; история: 2–10000 сообщений');
  const list = info.list,
    [lw, lh] = info.size,
    [rw, rh] = pair(root, 'size', read),
    [, ly] = pair(list, 'position', read),
    remainder = lh % info.rowHeight,
    scrollbars = list.children.filter((n) => n.kind.toLowerCase() === 'scrollbar'),
    minHeight = Math.max(
      info.rowHeight * 2,
      ...scrollbars.map((n) => lh - pair(n, 'size', read)[1] + 24),
    ),
    minRows = Math.ceil((minHeight - remainder) / info.rowHeight),
    maxRows = Math.floor((maxHeight - rh + lh - remainder) / info.rowHeight);
  if (maxRows < minRows) throw Error('Для чата недостаточно места на выбранном экране');
  rows = Math.min(maxRows, Math.max(minRows, rows));
  const height = rows * info.rowHeight + remainder,
    delta = height - lh,
    edits = new Map();
  function patch(node, key, text, occurrence = 0) {
    const field = node.props.filter((p) => p.key.toLowerCase() === key.toLowerCase())[occurrence];
    if (!field) return;
    text = Array.isArray(text) ? text.join(' ') : String(text);
    if (text !== read(node, key, '', occurrence))
      edits.set(field.start, { node, key: field.key, occurrence, value: text });
  }
  patch(root, 'size', [rw, rh + delta]);
  patch(list, 'size', [lw, height]);
  patch(list, 'maxItems', Math.max(history, rows));
  if (!delta)
    return {
      edits: [...edits.values()],
      rows,
      history: Math.max(history, rows),
      rowHeight: info.rowHeight,
    };
  for (const node of root.children.filter((n) => n.kind === 'control' && n !== list)) {
    const p = pair(node, 'position', read);
    if (p[1] >= ly + lh) patch(node, 'position', [p[0], p[1] + delta]);
  }
  for (const scrollbar of scrollbars) {
    const s = pair(scrollbar, 'size', read);
    patch(scrollbar, 'size', [s[0], s[1] + delta]);
    for (const button of scrollbar.children.filter((n) => n.kind.toLowerCase() === 'rightbutton')) {
      const p = pair(button, 'position', read);
      patch(button, 'position', [p[0], p[1] + delta]);
    }
  }
  const spriteName = read(root, 'drawMethod').match(/SPRITE\s+"([^"]+)"/i)?.[1],
    seam = ly + lh / 2;
  const background = walk(root).find(
    (n) => n.kind === 'sprite' && unquote(read(n, 'name')) === spriteName,
  );
  if (background) {
    const s = pair(background, 'size', read);
    patch(background, 'size', [s[0], s[1] + delta]);
    let occurrence = 0;
    for (const field of background.props.filter((p) => p.key.toLowerCase() === 'texture')) {
      const tokens = read(background, 'texture', field.value, occurrence).match(/"[^"]*"|\S+/g);
      if (tokens?.length === 9) {
        for (const i of [6, 8])
          if (Number(tokens[i]) > seam) tokens[i] = String(Number(tokens[i]) + delta);
        patch(background, 'texture', tokens.join(' '), occurrence);
      }
      occurrence++;
    }
  }
  for (const key of ['showEffect', 'hideEffect']) {
    const tokens = read(root, key).trim().split(/\s+/);
    if (/^MOVE_(?:TOP|BOTTOM)$/.test(tokens[0]) && tokens.length === 4)
      patch(
        root,
        key,
        [tokens[0], tokens[1], ...tokens.slice(2).map((n) => Number(n) + delta)].join(' '),
      );
  }
  return {
    edits: [...edits.values()],
    rows,
    history: Math.max(history, rows),
    rowHeight: info.rowHeight,
  };
}
