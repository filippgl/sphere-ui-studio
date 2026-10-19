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
// Native MOVE_* effects move the window for good: MOVE_LEFT/MOVE_TOP end at
// position + shift - distance, MOVE_RIGHT/MOVE_BOTTOM at position + shift
// (`type duration distance shift`, a missing shift is 0). The panel slides in to
// its docked spot and out over its edge: left edge when vertical, bottom when horizontal.
function slideEffect(key, horizontal, tokens) {
  const [, duration = '0.25', distance = '0'] = tokens,
    show = key === 'showEffect';
  return horizontal
    ? [show ? 'MOVE_TOP' : 'MOVE_BOTTOM', duration, distance, distance].join(' ')
    : [show ? 'MOVE_RIGHT' : 'MOVE_LEFT', duration, distance].join(' ');
}
function effectEdits(root, horizontal, read) {
  const edits = [];
  for (const key of ['showEffect', 'hideEffect']) {
    const tokens = read(root, key).trim().split(/\s+/);
    if (!/^MOVE_/.test(tokens[0])) continue;
    const value = slideEffect(key, horizontal, tokens);
    if (tokens.join(' ') !== value) edits.push({ node: root, key, value, occurrence: 0 });
  }
  return edits;
}
// Repairs panels turned by older versions, which kept MOVE_TOP without the shift
// and therefore stopped one panel height above the bottom edge.
export function planHotbarEffects(root, read = raw) {
  const info = hotbarInfo(root, read);
  return info ? effectEdits(root, info.horizontal, read) : [];
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
  let damaged = false;
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
  if (!info.horizontal && background) {
    const tokens = read(background, 'texture').match(/"[^"]*"|\S+/g);
    if (tokens?.length === 9) {
      const { points } = coords(0, ...tokens.slice(1, 5).map(Number));
      damaged = points[0] === points[2] && points[1] !== points[3];
    }
  }
  const mirror = info.horizontal && horizontal && legacy;
  const repairOnly = !info.horizontal && !horizontal && damaged;
  if (info.horizontal === horizontal && !mirror && !repairOnly) return [];
  const edits = [];
  const patch = (node, key, value, occurrence = 0) =>
    edits.push({ node, key, value: Array.isArray(value) ? value.join(' ') : value, occurrence });
  if (!mirror && !repairOnly) patch(root, 'size', [height, width]);
  if (!repairOnly) edits.push(...effectEdits(root, horizontal, read));
  for (const node of root.children.filter((n) => n.kind === 'control')) {
    if (repairOnly) continue;
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
    if (!mirror && !repairOnly)
      patch(background, 'size', read(background, 'size').trim().split(/\s+/).reverse());
    for (const [index, field] of background.props
      .filter((p) => p.key.toLowerCase() === 'texture')
      .entries()) {
      const tokens = read(background, 'texture', field.value, index).match(/"[^"]*"|\S+/g);
      if (tokens?.length !== 9) throw Error('Неизвестный формат рамки панели хоткеев');
      const [sx, sy, ex, ey, dx, dy, dex, dey] = tokens.slice(1).map(Number);
      const rect = repairOnly
        ? [dx, dy, dex, dey]
        : mirror
          ? [dx, height - dey, dex, height - dy]
          : horizontal
            ? [dy, width - dex, dey, width - dx]
            : legacy
              ? [dy, dx, dey, dex]
              : [height - dey, dx, height - dy, dex];
      patch(background, 'texture', [tokens[0], sx, sy, ex, ey, ...rect].join(' '), index);
      const { occurrence } = coords(index, sx, sy, ex, ey);
      const points = damaged
        ? [sx, sy, ex, sy, ex, ey, sx, ey]
        : coords(index, sx, sy, ex, ey).points;
      const order = repairOnly
        ? [0, 1, 2, 3]
        : mirror
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
