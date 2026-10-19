// Native alignWin uses RIGHT_Y for the bottom edge (BOTTOM_Y is accepted too).
export function anchors(value = '') {
  return [
    /RIGHT_X/.test(value) ? 1 : /CENTER_X/.test(value) ? 0.5 : 0,
    /RIGHT_Y|BOTTOM_Y/.test(value) ? 1 : /CENTER_Y/.test(value) ? 0.5 : 0,
  ];
}
export function placement(size, position, align, screen) {
  const a = anchors(align);
  return position.map((p, i) => p + (screen[i] - size[i]) * a[i]);
}
export function fitPlacement(size, position, align, screen) {
  const a = anchors(align),
    point = placement(size, position, align, screen);
  return point.map((p, i) =>
    Math.round(Math.max(0, Math.min(screen[i] - size[i], p)) - (screen[i] - size[i]) * a[i]),
  );
}
export function overflow(size, position, align, screen) {
  const [x, y] = placement(size, position, align, screen);
  return x < 0 || y < 0 || x + size[0] > screen[0] || y + size[1] > screen[1];
}
export function resolution(cfg = '') {
  const x = Number(cfg.match(/^\s*XRES\s+(\d+)/im)?.[1]);
  const y = Number(cfg.match(/^\s*YRES\s+(\d+)/im)?.[1]);
  return x >= 320 && x <= 16384 && y >= 200 && y <= 16384 ? [x, y] : null;
}
