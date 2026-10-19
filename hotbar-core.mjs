import { walk, unquote } from './ui-core.mjs';
const raw = (node, key, fallback = '', occurrence = 0) =>
  node.props.filter((p) => p.key.toLowerCase() === key.toLowerCase())[occurrence]?.value ??
  fallback;
export function hotbarInfo(root, read = raw) {
  if (unquote(read(root, 'windowName')) !== 'quick_items') return null;
  const size = read(root, 'size').split(/\s+/).map(Number);
  return {
    horizontal: size[0] > size[1],
    slots: root.children.filter((n) => /^(SLOT)$/i.test(read(n, 'classID'))).length,
  };
}
export function planHotbar(root, horizontal, read = raw, extraCoords = []) {
  const info = hotbarInfo(root, read);
  if (!info) throw Error('Выберите панель хоткеев quick_items');
  const [width, height] = read(root, 'size').trim().split(/\s+/).map(Number);
  const name = read(root, 'drawMethod').match(/SPRITE\s+"([^"]+)"/i)?.[1];
  const background = walk(root).find(
    (n) => n.kind === 'sprite' && unquote(read(n, 'name')) === name,
  );
  const coords = (index, sx, sy, ex, ey) => {
    const props = background.props.filter((p) => p.key.toLowerCase() === 'tcoords');
    const occurrence = props.findIndex((p) => Number(p.value.split(/\s+/)[0]) === index);
    const existing =
      occurrence >= 0
        ? read(background, 'tcoords', '', occurrence)
        : extraCoords.find(
            (p) => p.node === background.id && Number(p.value.split(/\s+/)[0]) === index,
          )?.value;
    return {
      occurrence,
      points: existing
        ? existing.trim().split(/\s+/).map(Number).slice(1)
        : [sx, sy, ex, sy, ex, ey, sx, ey],
    };
  };
  let legacy = false;
  if (info.horizontal && background) {
    const tokens = read(background, 'texture').match(/"[^"]*"|\S+/g);
    if (tokens?.length === 9) {
      const { points } = coords(0, ...tokens.slice(1, 5).map(Number));
      const area = [0, 1, 2, 3].reduce(
        (a, i) =>
          a +
          points[i * 2] * points[((i + 1) % 4) * 2 + 1] -
          points[((i + 1) % 4) * 2] * points[i * 2 + 1],
        0,
      );
      legacy = area < 0;
    }
  }
  const mirror = info.horizontal && horizontal && legacy;
  if (info.horizontal === horizontal && !mirror) return [];
  const edits = [];
  const patch = (node, key, value, occurrence = 0) =>
    edits.push({ node, key, value: Array.isArray(value) ? value.join(' ') : value, occurrence });
  if (!mirror) patch(root, 'size', [height, width]);
  const effects = horizontal
    ? { MOVE_LEFT: 'MOVE_BOTTOM', MOVE_RIGHT: 'MOVE_TOP' }
    : legacy
      ? { MOVE_TOP: 'MOVE_LEFT', MOVE_BOTTOM: 'MOVE_RIGHT' }
      : { MOVE_BOTTOM: 'MOVE_LEFT', MOVE_TOP: 'MOVE_RIGHT' };
  for (const key of ['showEffect', 'hideEffect']) {
    const tokens = read(root, key).trim().split(/\s+/);
    if (effects[tokens[0]]) patch(root, key, [effects[tokens[0]], ...tokens.slice(1)].join(' '));
  }
  for (const node of root.children.filter((n) => n.kind === 'control')) {
    const position = read(node, 'position').trim().split(/\s+/).map(Number);
    const [w, h] = read(node, 'size', '0 0').trim().split(/\s+/).map(Number);
    const [x, y] = position;
    const offset = Math.floor((h - w) / 2);
    if (position.length === 2)
      patch(
        node,
        'position',
        mirror
          ? [x, height - y - h]
          : horizontal
            ? [y + offset, width - x - w - offset]
            : legacy
              ? [y, x]
              : [height - y - w - offset, x - offset],
      );
    // SLOT and button sizes, textures, glyphs and item orientation remain unchanged.
  }
  if (background) {
    if (!mirror) patch(background, 'size', read(background, 'size').trim().split(/\s+/).reverse());
    for (const [index, field] of background.props
      .filter((p) => p.key.toLowerCase() === 'texture')
      .entries()) {
      const tokens = read(background, 'texture', field.value, index).match(/"[^"]*"|\S+/g);
      if (tokens?.length !== 9) throw Error('Неизвестный формат рамки панели хоткеев');
      const [sx, sy, ex, ey, dx, dy, dex, dey] = tokens.slice(1).map(Number);
      const rect = mirror
        ? [dx, height - dey, dex, height - dy]
        : horizontal
          ? [dy, width - dex, dey, width - dx]
          : legacy
            ? [dy, dx, dey, dex]
            : [height - dey, dx, height - dy, dex];
      patch(background, 'texture', [tokens[0], sx, sy, ex, ey, ...rect].join(' '), index);
      const { occurrence, points } = coords(index, sx, sy, ex, ey);
      const order = mirror
        ? [3, 2, 1, 0]
        : horizontal
          ? [1, 2, 3, 0]
          : legacy
            ? [0, 3, 2, 1]
            : [3, 0, 1, 2];
      const transposed = [index, ...order.flatMap((i) => points.slice(i * 2, i * 2 + 2))].join(' ');
      edits.push({
        node: background,
        key: 'tcoords',
        value: transposed,
        occurrence,
        insert: occurrence < 0,
      });
    }
  }
  return edits;
}
