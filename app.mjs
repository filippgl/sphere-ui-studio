import { createStorage } from './storage.mjs';
const storage = await createStorage();
const $ = (id) => document.getElementById(id);
const walk = (n) => [n, ...n.children.flatMap(walk)];
const get = (n, key, occurrence = 0) =>
  n?.props.filter((p) => p.key.toLowerCase() === key.toLowerCase())[occurrence];
const clean = (s) => String(s).replace(/^"|"$/g, '');
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  frame: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
  folder:
    '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  'chevron-down': '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  cursor: '<path d="m5 3 14 9-7 1-3 7Z"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-3 0-4-2-6-4l-3-5a2 2 0 0 1 3-2l2 2"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo: '<path d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><circle cx="12" cy="12" r="3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7 18 18 0 0 1-3 4M6 6a20 20 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock:
    '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2M12 14v3"/>',
  text: '<path d="M4 6V4h16v2M12 4v16M8 20h8"/>',
  button: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M8 12h8"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9ZM2 14l10 6 10-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  book: '<path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z"/>',
  sliders:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="#232427"/><circle cx="16" cy="17" r="2" fill="#232427"/>',
  scale: '<rect x="3" y="10" width="11" height="11" rx="1"/><path d="M10 3h11v11M21 3 11 13"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  paste: '<path d="M9 4H5v17h14V4h-4"/><rect x="9" y="2" width="6" height="5" rx="1"/>',
  'align-left': '<path d="M4 3v18M8 6h12v4H8ZM8 14h8v4H8Z"/>',
  'align-center-x': '<path d="M12 2v3M12 10v4M12 19v3M4 5h16v5H4ZM7 14h10v5H7Z"/>',
  'align-right': '<path d="M20 3v18M4 6h12v4H4ZM8 14h8v4H8Z"/>',
  'align-top': '<path d="M3 4h18M6 8h4v12H6ZM14 8h4v8h-4Z"/>',
  'align-center-y': '<path d="M2 12h3M10 12h4M19 12h3M5 4h5v16H5ZM14 7h5v10h-5Z"/>',
  'align-bottom': '<path d="M3 20h18M6 4h4v12H6ZM14 8h4v8h-4Z"/>',
  'distribute-x': '<path d="M3 3v18M21 3v18M8 7h3v10H8ZM14 5h3v14h-3Z"/>',
  'distribute-y': '<path d="M3 3h18M3 21h18M7 8h10v3H7ZM5 14h14v3H5Z"/>',
};
function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
  return span.firstChild;
}
function icons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => n.replaceChildren(icon(n.dataset.icon)));
}
function el(tag, cls = '', text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
icons();
const titles = {
  pick_person: 'Выбор персонажа',
  create_person: 'Создание персонажа',
  del_char_window: 'Удаление персонажа',
  inventory: 'Инвентарь',
  puppet: 'Персонаж и снаряжение',
  chat: 'Чат',
  bank: 'Банк',
  connect_message: 'Потеря связи',
  connection: 'Вход в игру',
  trade: 'Торговля',
  statinfo: 'Характеристики',
  container: 'Контейнер',
  options: 'Настройки',
  quickitems: 'Панель предметов',
  minimap: 'Миникарта',
  bnk_selcount: 'Сумма операции',
  npcguild: 'Гильдия',
  ally: 'Альянсы и войны',
};
const classes = {
  BUTTON: 'Кнопка',
  TEXT: 'Текст',
  IMAGE: 'Изображение',
  EDIT: 'Поле ввода',
  SLOT: 'Ячейка',
  SCROLLBAR: 'Прокрутка',
  TEXTLIST: 'Список',
  RICHEDIT: 'Текстовое поле',
  PROGRESS_BAR: 'Индикатор',
  CHECKBOX: 'Переключатель',
};
let data,
  windows = [],
  active,
  selected,
  selection = [],
  filter = 'all',
  edits = new Map(),
  undo = [],
  redo = [],
  zoom = 1,
  origin = [0, 0],
  globalSprites = [];
let images = new Map(),
  drag,
  hover,
  guides = [],
  paintPending = false,
  tool = 'select',
  space = false,
  tween,
  clipboard,
  commandItems = [],
  commandIndex = 0,
  batchDepth = 0,
  viewMode = 'fit';
const visibility = new Map(),
  locked = new Set(),
  views = new Map();
const canvas = $('canvas'),
  ctx = canvas.getContext('2d'),
  viewport = $('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const keyFor = (file, p) => `${file.name}:${p.start}`;
const nodeKey = (n) => `${active.file.name}:${n.id}`;
const changed = (file) => [...edits.keys()].some((k) => k.startsWith(file.name + ':'));
const val = (n, key, fallback = '', file = active?.file) => {
  const p = get(n, key);
  return p ? (edits.get(keyFor(file, p))?.value ?? p.value) : fallback;
};
const nums = (n, key, fallback = '0 0', file = active?.file) =>
  val(n, key, fallback, file).trim().split(/\s+/).map(Number);
const isHidden = (n) => visibility.get(nodeKey(n)) ?? /^true$/i.test(val(n, 'hidden'));
const isLocked = (n) => locked.has(nodeKey(n));
const resolveText = (raw) => {
  const key = clean(raw);
  return data?.strings[key] ?? (/^UISTR_/i.test(key) ? '' : key);
};
const nodeIcon = (n) =>
  n === active?.node
    ? 'frame'
    : {
        BUTTON: 'button',
        TEXT: 'text',
        EDIT: 'text',
        IMAGE: 'image',
        TEXTLIST: 'list',
        RICHEDIT: 'text',
      }[val(n, 'classID').toUpperCase()] || 'box';
function nodeLabel(n) {
  if (n === active.node) return active.title;
  const text = resolveText(val(n, 'windowText'));
  const tooltip = n.children.find((n) => n.kind === 'tooltip');
  const help = tooltip && resolveText(get(tooltip, 'toolstr')?.value || '');
  return (
    text ||
    help ||
    `${classes[val(n, 'classID').toUpperCase()] || 'Элемент'} ${active.controls.indexOf(n) + 1}`
  );
}
function toast(text, error = false) {
  $('toast-text').textContent = text;
  $('toast-icon').replaceChildren(icon(error ? 'info' : 'check'));
  $('toast').classList.toggle('error', error);
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 4200);
}
const api = (url, body) => storage.call(url, body);
const guarded =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
function rebuild() {
  const library = data.files.find((f) => f.name.toLowerCase() === 'sprites.ui');
  globalSprites = library
    ? walk(library.tree)
        .filter((n) => n.kind === 'sprite')
        .map((node) => ({ node, file: library }))
    : [];
  windows = data.files.flatMap((file) =>
    walk(file.tree)
      .filter((n) => n.kind === 'windowUI')
      .map((node) => {
        const name = clean(get(node, 'windowName')?.value || file.name);
        return {
          file,
          node,
          name,
          title: titles[name] || resolveText(get(node, 'windowText')?.value || '') || name,
          controls: node.children.filter((n) => n.kind === 'control'),
        };
      }),
  );
  $('count').textContent = windows.length;
}
function list() {
  const search = $('search').value.toLowerCase();
  $('windows').replaceChildren();
  for (const w of windows.filter(
    (w) =>
      `${w.title} ${w.name} ${w.file.name}`.toLowerCase().includes(search) &&
      (filter !== 'main' || titles[w.name]) &&
      (filter !== 'dirty' || changed(w.file)),
  )) {
    const b = el('button', 'window-item' + (w === active ? ' active' : ''));
    const name = el('span', 'name', w.title);
    b.append(name, el('small', '', `${w.file.name} · ${w.controls.length} элементов`));
    if (changed(w.file)) name.prepend(el('span', 'modified', '●'));
    b.onclick = () => {
      choose(w);
      navTab('layers');
    };
    $('windows').append(b);
  }
}
function layers() {
  $('layers').replaceChildren();
  if (!active) return;
  const search = $('layer-search').value.toLowerCase();
  $('layer-count').textContent = active.controls.length;
  for (const n of [active.node, ...active.controls]) {
    const index = active.controls.indexOf(n) + 1,
      label = nodeLabel(n);
    if (
      search &&
      !`${label} ${val(n, 'classID')} ${index} ${val(n, 'windowText')}`
        .toLowerCase()
        .includes(search)
    )
      continue;
    const row = el('div', 'layer' + (n === active.node ? ' root' : ''));
    row.dataset.node = n.id;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', n === active.node ? '1' : '2');
    row.tabIndex = 0;
    const glyph = el('span', 'layer-glyph');
    glyph.append(icon(nodeIcon(n)));
    row.append(glyph, el('span', 'layer-name', label));
    if (index) row.append(el('span', 'layer-number', String(index).padStart(2, '0')));
    row.title = `${label}${index ? ' · #' + index : ''}${/^true$/i.test(val(n, 'hidden')) ? ' · Скрыт в клиенте' : ''}`;
    if (n !== active.node) {
      const actions = el('div', 'layer-actions');
      const eye = el('button', 'icon-button');
      eye.setAttribute('aria-label', `Видимость: ${label}`);
      eye.title = 'Видимость в предпросмотре';
      eye.append(icon(isHidden(n) ? 'eye-off' : 'eye'));
      eye.classList.toggle('is-set', isHidden(n));
      eye.onclick = (e) => {
        e.stopPropagation();
        visibility.set(nodeKey(n), !isHidden(n));
        layers();
        inspector();
        paint();
      };
      const lock = el('button', 'icon-button');
      lock.setAttribute('aria-label', `Блокировка: ${label}`);
      lock.title = 'Блокировка редактирования';
      lock.append(icon(isLocked(n) ? 'lock' : 'unlock'));
      lock.classList.toggle('is-set', isLocked(n));
      lock.onclick = (e) => {
        e.stopPropagation();
        isLocked(n) ? locked.delete(nodeKey(n)) : locked.add(nodeKey(n));
        layers();
        inspector();
        paint();
      };
      actions.append(eye, lock);
      row.append(actions);
    }
    row.onclick = (e) => selectWithModifiers(n, e);
    row.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        selectWithModifiers(n, e);
        viewport.focus();
      }
    };
    row.ondblclick = () => {
      setSelection([n]);
      focusSelection();
    };
    row.onpointerenter = () => {
      hover = n;
      paint();
    };
    row.onpointerleave = () => {
      hover = null;
      paint();
    };
    $('layers').append(row);
  }
  layerStates();
}
function layerStates() {
  document.querySelectorAll('.layer').forEach((row) => {
    const n = [active.node, ...active.controls].find((n) => n.id === row.dataset.node);
    row.classList.toggle('active', selection.includes(n));
    row.setAttribute('aria-selected', String(selection.includes(n)));
    row.classList.toggle('is-hidden', n !== active.node && isHidden(n));
    row.classList.toggle('is-locked', isLocked(n));
    row.classList.toggle('hovered', hover === n);
  });
}
function updateDirty() {
  const files = new Set([...edits.values()].map((e) => e.file));
  $('dirty').textContent = files.size ? `Изменено файлов: ${files.size}` : 'Нет изменений';
  $('dirty').classList.toggle('changed', !!files.size);
  const pending = data && $('client-path').value !== (data.client || '');
  $('save').disabled = !files.size || pending;
  $('save').title = `Сохранить в ${data?.client || 'выбранный клиент'}`;
  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
  $('files-note').textContent = files.size ? `Изменены: ${[...files].join(', ')}` : '';
}
function state(frameView = false) {
  return {
    edits: new Map(edits),
    window: active?.name,
    ids: selection.map((n) => n.id),
    frameView: frameView ? { origin: [...origin], zoom, mode: viewMode } : null,
  };
}
function snapshot(frameView = false) {
  undo.push(state(frameView));
  if (undo.length > 100) undo.shift();
  redo = [];
  updateDirty();
}
function restoreState(s) {
  edits = new Map(s.edits);
  if (s.window && active?.name !== s.window)
    choose(
      windows.find((w) => w.name === s.window),
      false,
    );
  setSelection([active.node, ...active.controls].filter((n) => s.ids.includes(n.id)));
  if (s.frameView) {
    viewMode = s.frameView.mode;
    setView(s.frameView.zoom, s.frameView.origin, false);
  }
  list();
  updateDirty();
}
function batchEdit(fn) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (!batchDepth) {
      updateDirty();
      paint();
    }
  }
}
function edit(n, key, text, file = active.file, occurrence = 0) {
  const p = get(n, key, occurrence);
  if (!p) return;
  const k = keyFor(file, p);
  if (String(text) === p.value) edits.delete(k);
  else
    edits.set(k, {
      file: file.name,
      node: n.id,
      key: p.key,
      start: p.start,
      end: p.end,
      value: String(text),
    });
  if (!batchDepth) {
    updateDirty();
    paint();
  }
}
function choose(w, animate = true) {
  if (!w) return;
  if (active) views.set(active.name, { zoom, origin: [...origin], mode: viewMode });
  active = w;
  selected = w.node;
  selection = [w.node];
  hover = null;
  guides = [];
  drag = null;
  $('title').textContent = w.title;
  $('frame-name').textContent = w.title;
  $('filename').textContent = w.file.name;
  $('subtitle').textContent = w.name;
  $('elements').replaceChildren();
  for (const n of [w.node, ...w.controls])
    $('elements').append(
      new Option(
        n === w.node ? 'Окно целиком' : `#${w.controls.indexOf(n) + 1} · ${nodeLabel(n)}`,
        n.id,
      ),
    );
  $('empty-state').hidden = true;
  $('frame-label').hidden = false;
  $('layer-search').value = '';
  list();
  layers();
  inspector();
  if (views.has(w.name)) {
    const v = views.get(w.name);
    viewMode = v.mode;
    if (viewMode === 'fit') fit(animate);
    else setView(v.zoom, v.origin, animate);
  } else fit(animate);
}
function setSelection(nodes) {
  selection = [...new Set(nodes)];
  if (selection.length > 1) selection = selection.filter((n) => n !== active.node);
  selected = selection.at(-1) || null;
  if (selected) $('elements').value = selected.id;
  layerStates();
  inspector();
  paint();
}
function selectWithModifiers(n, e) {
  if (n === active.node) {
    setSelection([n]);
    return;
  }
  if (e.shiftKey && selected && selected !== active.node && !e.ctrlKey && !e.metaKey) {
    const a = active.controls.indexOf(selected),
      b = active.controls.indexOf(n);
    setSelection([
      ...selection.filter((n) => n !== active.node),
      ...active.controls.slice(Math.min(a, b), Math.max(a, b) + 1),
    ]);
  } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
    setSelection(selection.includes(n) ? selection.filter((x) => x !== n) : [...selection, n]);
  } else setSelection([n]);
}
function rect(n) {
  const p = n === active.node ? [0, 0] : nums(n, 'position'),
    s = nums(n, 'size', '1 1');
  return { x: p[0], y: p[1], w: s[0], h: s[1] };
}
function bounds(nodes = selection) {
  if (!nodes.length) return null;
  const r = nodes.map(rect);
  const x = Math.min(...r.map((r) => r.x)),
    y = Math.min(...r.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...r.map((r) => r.x + r.w)) - x,
    h: Math.max(...r.map((r) => r.y + r.h)) - y,
  };
}
function applyRect(n, r) {
  if (n !== active.node) edit(n, 'position', `${Math.round(r.x)} ${Math.round(r.y)}`);
  edit(n, 'size', `${clamp(Math.round(r.w), 1, 32768)} ${clamp(Math.round(r.h), 1, 32768)}`);
}
function resizeGroup(base, target, items) {
  for (const { n, r } of items) {
    if (isLocked(n)) continue;
    applyRect(n, {
      x: target.x + ((r.x - base.x) * target.w) / base.w,
      y: target.y + ((r.y - base.y) * target.h) / base.h,
      w: (r.w * target.w) / base.w,
      h: (r.h * target.h) / base.h,
    });
  }
}
function transformField(key, index, value) {
  if (!selection.length || !Number.isFinite(value)) return;
  value = Math.round(value);
  snapshot();
  if (selection.length === 1) {
    const a = nums(selected, key);
    a[index] = key === 'size' ? clamp(value, 1, 32768) : clamp(value, -32768, 32768);
    edit(selected, key, a.join(' '));
  } else {
    const b = bounds(),
      target = { ...b };
    if (key === 'position') {
      const delta = value - (index ? b.y : b.x);
      for (const n of selection.filter((n) => !isLocked(n))) {
        const p = nums(n, 'position');
        p[index] += delta;
        edit(n, 'position', p.join(' '));
      }
    } else {
      target[index ? 'h' : 'w'] = clamp(value, 1, 32768);
      resizeGroup(
        b,
        target,
        selection.map((n) => ({ n, r: rect(n) })),
      );
    }
  }
  layers();
  inspector();
}
function inspector() {
  $('fields').replaceChildren();
  $('selection-notes').replaceChildren();
  const multi = selection.length > 1,
    none = !selected,
    disabled = none || selection.every(isLocked);
  $('selected-name').textContent = none
    ? 'Ничего не выбрано'
    : multi
      ? `${selection.length} элементов`
      : nodeLabel(selected);
  $('selected-meta').textContent = none
    ? 'Выделите элемент на холсте'
    : multi
      ? 'Совместное редактирование'
      : selected === active.node
        ? `${active.controls.length} элементов · ${active.file.name}`
        : `${classes[val(selected, 'classID').toUpperCase()] || val(selected, 'classID')} · #${active.controls.indexOf(selected) + 1}`;
  $('selected-icon').replaceChildren(icon(none || multi ? 'layers' : nodeIcon(selected)));
  $('node-kind').textContent = multi
    ? 'MULTI'
    : none
      ? 'CANVAS'
      : selected === active.node
        ? 'FRAME'
        : val(selected, 'classID');
  $('elements').disabled = none || multi;
  document
    .querySelectorAll('[data-align]')
    .forEach((b) => (b.disabled = disabled || selected === active?.node));
  $('selection-focus').disabled = none;
  source();
  if (none) return;
  const group = (title, note = '') => {
    const section = el('section', 'field-group'),
      h = el('h3', '', title);
    if (note) h.append(el('span', '', note));
    const grid = el('div', 'field-grid');
    section.append(h, grid);
    $('fields').append(section);
    return grid;
  };
  const geometry = group('Положение и размер', multi ? 'Группа' : 'px'),
    b = bounds();
  for (const [key, labels] of [
    ['position', ['X', 'Y']],
    ['size', ['Ширина', 'Высота']],
  ]) {
    if (!multi && !get(selected, key)) continue;
    const values = multi ? (key === 'position' ? [b.x, b.y] : [b.w, b.h]) : nums(selected, key);
    values.forEach((v, index) => {
      const label = el('label', '', labels[index]),
        input = el('input');
      input.type = 'number';
      input.value = Math.round(v);
      input.min = key === 'size' ? 1 : -32768;
      input.max = 32768;
      input.disabled = disabled;
      input.setAttribute('aria-label', labels[index]);
      input.onchange = () => transformField(key, index, input.valueAsNumber);
      label.append(input);
      geometry.append(label);
    });
  }
  if (multi && selection.length >= 3) {
    for (const [axis, title] of [
      ['x', 'Распределить по горизонтали'],
      ['y', 'Распределить по вертикали'],
    ]) {
      const b = el('button', '', axis === 'x' ? 'По горизонтали' : 'По вертикали');
      b.prepend(icon('distribute-' + axis));
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = disabled;
      b.onclick = () => distribute(axis);
      geometry.append(b);
    }
  }
  const keys = [
    'font',
    'textcolor',
    'focuscolor',
    'disabledcolor',
    'alignWin',
    'textFormat',
    'windowText',
  ];
  const available = keys.filter((key) => selection.every((n) => get(n, key)));
  if (!available.length) {
    source();
    return;
  }
  const appearance = group('Оформление');
  const names = {
    font: 'Шрифт',
    textcolor: 'Цвет текста',
    focuscolor: 'При наведении',
    disabledcolor: 'Неактивный элемент',
    alignWin: 'Привязка окна',
    textFormat: 'Выравнивание текста',
    windowText: 'Текст или ключ перевода',
  };
  for (const key of available) {
    const label = el('label', 'wide', names[key]),
      input = el(key === 'font' ? 'select' : 'input');
    input.setAttribute('aria-label', names[key]);
    input.disabled = disabled;
    const mixed = selection.some((n) => val(n, key) !== val(selected, key));
    if (key === 'font') {
      if (mixed) input.append(new Option('Разные шрифты', ''));
      for (const f of data.fonts || [])
        input.append(new Option(`${f.id} · ${f.name}`, String(f.id)));
      input.value = mixed ? '' : val(selected, key);
      input.onchange = () => {
        if (input.value === '') return;
        snapshot();
        for (const n of selection.filter((n) => !isLocked(n))) edit(n, key, input.value);
        source();
      };
      label.append(input);
    } else if (key.includes('color')) {
      input.type = 'color';
      const rgb = nums(selected, key)
        .slice(0, 3)
        .map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0'))
        .join('');
      input.value = '#' + rgb;
      const box = el('div', 'color-field'),
        hex = el('span', '', mixed ? 'Разные цвета' : rgb.toUpperCase());
      box.append(input, hex);
      input.onchange = () => {
        snapshot();
        for (const n of selection.filter((n) => !isLocked(n)))
          edit(
            n,
            key,
            [
              ...input.value
                .slice(1)
                .match(/../g)
                .map((v) => parseInt(v, 16)),
              ...nums(n, key).slice(3),
            ].join(' '),
          );
        hex.textContent = input.value.slice(1).toUpperCase();
        source();
      };
      label.append(box);
    } else {
      input.type = 'text';
      input.value = mixed ? '' : val(selected, key);
      input.placeholder = mixed ? 'Разные значения' : '';
      input.onchange = () => {
        snapshot();
        for (const n of selection.filter((n) => !isLocked(n))) edit(n, key, input.value);
        layers();
        source();
      };
      label.append(input);
    }
    appearance.append(label);
    if (key === 'windowText' && !multi) {
      const raw = clean(val(selected, key)),
        translated = resolveText(raw);
      const description = el(
        'div',
        'field-description',
        translated || 'Нет перевода. Служебный ключ не отображается на холсте.',
      );
      if (raw !== translated) description.append(el('span', 'translation-key', raw));
      appearance.append(description);
    }
  }
  if (!multi) {
    if (/^true$/i.test(val(selected, 'hidden')))
      note('Этот элемент скрыт в клиенте. Значок глаза управляет только предпросмотром.');
    if (isLocked(selected)) note('Слой заблокирован. Снимите блокировку в списке слоёв.');
    const r = rect(selected),
      root = rect(active.node);
    if (
      selected !== active.node &&
      (r.x < 0 || r.y < 0 || r.x + r.w > root.w || r.y + r.h > root.h)
    )
      note('Область элемента выходит за окно. Предпросмотр обрезается по границе окна.', 'warning');
  }
  source();
}
function note(text, kind = '') {
  const n = el('div', 'property-note ' + kind, text);
  n.prepend(icon('info'));
  $('selection-notes').append(n);
}
function source() {
  if (!selected) {
    $('source').textContent = 'Выделите элемент, чтобы посмотреть описание.';
    $('selection').textContent = 'Ничего не выбрано';
    return;
  }
  $('source').textContent =
    `${selected.kind}\n{\n${selected.props.map((p) => '  ' + p.key + ' ' + (edits.get(keyFor(active.file, p))?.value ?? p.value)).join('\n')}\n}`;
  $('selection').textContent =
    selection.length > 1
      ? `Выбрано элементов: ${selection.length}`
      : selected === active.node
        ? `Окно · ${active.title}`
        : `#${active.controls.indexOf(selected) + 1} · ${nodeLabel(selected)}`;
}

function sprite(name) {
  const node = walk(active.node).find((n) => n.kind === 'sprite' && clean(val(n, 'name')) === name);
  return node
    ? { node, file: active.file }
    : globalSprites.find((s) => clean(val(s.node, 'name', '', s.file)) === name);
}
function image(name) {
  if (images.has(name)) return images.get(name);
  const im = new Image();
  images.set(name, im);
  im.onload = paint;
  im.onerror = () => {
    im.failed = true;
    paint();
  };
  storage
    .texture(name)
    .then((url) => {
      im.src = url;
    })
    .catch(() => {
      im.failed = true;
      paint();
    });
  return im;
}
function texturedTriangle(im, source, target) {
  const [s0, s1, s2] = source,
    [d0, d1, d2] = target;
  const ux = s1[0] - s0[0],
    uy = s1[1] - s0[1],
    vx = s2[0] - s0[0],
    vy = s2[1] - s0[1];
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 0.0001) return;
  const dx = d1[0] - d0[0],
    dy = d1[1] - d0[1],
    ex = d2[0] - d0[0],
    ey = d2[1] - d0[1];
  const a = (dx * vy - ex * uy) / det,
    c = (ex * ux - dx * vx) / det;
  const b = (dy * vy - ey * uy) / det,
    d = (ey * ux - dy * vx) / det;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...d0);
  ctx.lineTo(...d1);
  ctx.lineTo(...d2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]);
  ctx.drawImage(im, 0, 0);
  ctx.restore();
}
function drawSprite(name, x, y, width, height) {
  const owner = sprite(clean(name));
  if (!owner) return false;
  const s = owner.node,
    file = owner.file;
  const size = nums(s, 'size', `${width} ${height}`, file);
  let drawn = false;
  const pieces = s.props.filter((p) => p.key === 'texture');
  for (const [index, p] of pieces.entries()) {
    const raw = edits.get(keyFor(file, p))?.value ?? p.value;
    const tokens = raw.match(/"[^"]*"|\S+/g);
    if (tokens.length < 9) continue;
    const im = image(clean(tokens[0]));
    if (!im.complete || !im.naturalWidth || im.failed) continue;
    const [sx, sy, ex, ey, dx, dy, dex, dey] = tokens.slice(1).map(Number);
    const custom = s.props
      .filter((p) => p.key === 'tcoords')
      .map((p) => p.value.split(/\s+/).map(Number))
      .find((a) => a[0] === index);
    if ((!custom && (sx === ex || sy === ey)) || dx === dex || dy === dey) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(width / (size[0] || width), height / (size[1] || height));
    if (custom) {
      const src = Array.from({ length: 4 }, (_, i) => custom.slice(1 + i * 2, 3 + i * 2));
      const dst = [
        [dx, dy],
        [dex, dy],
        [dex, dey],
        [dx, dey],
      ];
      texturedTriangle(im, [src[0], src[1], src[2]], [dst[0], dst[1], dst[2]]);
      texturedTriangle(im, [src[0], src[2], src[3]], [dst[0], dst[2], dst[3]]);
      ctx.restore();
      drawn = true;
      continue;
    }
    // Mirrored texture rectangles occur in the original window descriptions
    ctx.translate(dx, dy);
    ctx.scale(dex < dx ? -1 : 1, dey < dy ? -1 : 1);
    try {
      ctx.drawImage(
        im,
        Math.min(sx, ex),
        Math.min(sy, ey),
        Math.abs(ex - sx),
        Math.abs(ey - sy),
        0,
        0,
        Math.abs(dex - dx),
        Math.abs(dey - dy),
      );
      drawn = true;
    } catch {}
    ctx.restore();
  }
  return drawn;
}

function stageSize() {
  return $('screen-mode').checked
    ? $('resolution').value.split(' × ').map(Number)
    : nums(active.node, 'size', '400 300');
}
function windowOffset() {
  if (!$('screen-mode').checked) return [0, 0];
  const [sw, sh] = stageSize(),
    [w, h] = nums(active.node, 'size'),
    [x, y] = nums(active.node, 'position');
  const anchor = val(active.node, 'alignWin');
  return [
    x + (anchor.includes('RIGHT_X') ? sw - w : anchor.includes('CENTER_X') ? (sw - w) / 2 : 0),
    y + (anchor.includes('BOTTOM_Y') ? sh - h : anchor.includes('CENTER_Y') ? (sh - h) / 2 : 0),
  ];
}
function paint() {
  if (!paintPending) {
    paintPending = true;
    requestAnimationFrame(draw);
  }
}
function drawText(n, r, raw = val(n, 'windowText')) {
  const text = resolveText(raw);
  if (!text || r.w <= 0 || r.h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const color = nums(n, 'textcolor', val(active.node, 'textcolor', '237 208 161'));
  ctx.fillStyle = `rgb(${color.slice(0, 3).join(' ')})`;
  const id = Number(val(n, 'font', val(active.node, 'font', '3'))),
    family =
      id === 3
        ? 'Georgia'
        : {
            5: 'Arial',
            6: 'Calibri',
            7: 'Century',
            8: 'Consolas',
            9: 'Garamond',
            10: 'Georgia',
            11: 'Arial',
            12: 'Times New Roman',
            13: 'Verdana',
          }[id] || 'Tahoma';
  const size = Math.max(1, Math.min(id === 0 || id === 2 ? 10 : id === 1 ? 14 : 13, r.h - 2));
  ctx.font = `${size}px ${family}`;
  const align = val(n, 'textFormat').toUpperCase(),
    offset = nums(n, 'textofs', '0 0');
  ctx.textAlign = align.includes('CENTER_X')
    ? 'center'
    : align.includes('RIGHT_X')
      ? 'right'
      : 'left';
  ctx.textBaseline = 'middle';
  const x =
      r.x +
      (ctx.textAlign === 'center' ? r.w / 2 : ctx.textAlign === 'right' ? r.w - 2 : 2) +
      offset[0],
    y = r.y + r.h / 2 + offset[1];
  ctx.fillText(text, x, y);
  ctx.restore();
}
function draw() {
  paintPending = false;
  if (tween) {
    const p = clamp((performance.now() - tween.time) / tween.duration, 0, 1),
      t = 1 - Math.pow(1 - p, 3);
    zoom = tween.fromZ + (tween.toZ - tween.fromZ) * t;
    origin = tween.fromO.map((v, i) => v + (tween.toO[i] - v) * t);
    if (p === 1) tween = null;
    else paint();
  }
  const width = viewport.clientWidth,
    height = viewport.clientHeight,
    dpr = devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.scale(dpr, dpr);
  if ($('grid').checked) {
    const step = clamp(20 * zoom, 12, 60),
      ox = ((origin[0] % step) + step) % step,
      oy = ((origin[1] % step) + step) % step;
    ctx.fillStyle = '#33353e';
    for (let x = ox; x < width; x += step)
      for (let y = oy; y < height; y += step) ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  if (!active) {
    $('frame-label').hidden = true;
    $('dimension-label').textContent = '';
    return;
  }
  ctx.save();
  ctx.translate(...origin);
  ctx.scale(zoom, zoom);
  if ($('screen-mode').checked) {
    const [sw, sh] = stageSize();
    ctx.fillStyle = '#20232a';
    ctx.fillRect(0, 0, sw, sh);
    ctx.strokeStyle = '#444650';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(0, 0, sw, sh);
    ctx.translate(...windowOffset());
  }
  const [w, h] = nums(active.node, 'size', '400 300');
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 6;
  ctx.shadowColor = '#0006';
  ctx.fillStyle = '#292a27';
  ctx.fillRect(0, 0, w, h);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const rootSprite = val(active.node, 'drawMethod').match(/SPRITE\s+"([^"]+)"/i);
  if (rootSprite) drawSprite(rootSprite[1], 0, 0, w, h);
  if (get(active.node, 'rectTitle') && nums(active.node, 'showTitle', '0')[0]) {
    const [x, y, ex, ey] = nums(active.node, 'rectTitle');
    drawText(active.node, { x, y, w: ex - x, h: ey - y });
  }
  for (const n of active.controls) {
    if (isHidden(n)) continue;
    const r = rect(n),
      cls = val(n, 'classID').toUpperCase();
    const spriteName = val(n, 'uncheckedImage') || val(n, 'image') || val(n, 'normalImage');
    const textured = spriteName && drawSprite(spriteName, r.x, r.y, r.w, r.h);
    if (
      !textured &&
      ['EDIT', 'SLOT', 'TEXTLIST', 'RICHEDIT', 'LISTITEM', 'PROGRESS_BAR'].includes(cls)
    ) {
      ctx.fillStyle = '#080a0d50';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    drawText(n, r);
    if ($('bounds').checked) {
      ctx.strokeStyle = '#a99bff2c';
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#41434b';
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(0, 0, w, h);
  if (hover && !selection.includes(hover) && !drag) {
    const r = rect(hover);
    ctx.strokeStyle = '#a99bffbb';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  if (selection.length) {
    const b = bounds();
    ctx.strokeStyle = '#ab99ff';
    ctx.lineWidth = 1 / zoom;
    if (selection.length > 1) {
      ctx.globalAlpha = 0.55;
      for (const n of selection) {
        const r = rect(n);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    if (!selection.every(isLocked)) {
      for (const [x, y] of handlePoints(b)) {
        ctx.fillStyle = '#f2eeff';
        ctx.fillRect(x - 3 / zoom, y - 3 / zoom, 6 / zoom, 6 / zoom);
        ctx.strokeStyle = '#8e78ef';
        ctx.strokeRect(x - 3 / zoom, y - 3 / zoom, 6 / zoom, 6 / zoom);
      }
    }
    const [oX, oY] = windowOffset();
    $('dimension-label').textContent = `${Math.round(b.w)} × ${Math.round(b.h)}`;
    $('dimension-label').style.left = origin[0] + (oX + b.x + b.w / 2) * zoom + 'px';
    $('dimension-label').style.top = origin[1] + (oY + b.y + b.h) * zoom + 9 + 'px';
  } else $('dimension-label').textContent = '';
  if (guides.length) {
    ctx.strokeStyle = '#ed8dcd';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([3 / zoom, 3 / zoom]);
    for (const g of guides) {
      ctx.beginPath();
      if (g.axis === 'x') {
        ctx.moveTo(g.value, -20);
        ctx.lineTo(g.value, h + 20);
      } else {
        ctx.moveTo(-20, g.value);
        ctx.lineTo(w + 20, g.value);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (drag?.type === 'marquee') {
    const r = drag.marquee;
    ctx.fillStyle = '#9d89ff16';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#b5a2ff';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
  const off = windowOffset();
  $('frame-label').textContent = active.title;
  $('frame-label').style.left = origin[0] + off[0] * zoom + 'px';
  $('frame-label').style.top = origin[1] + off[1] * zoom + 'px';
  $('zoom-label').textContent = Math.round(zoom * 100) + '%';
}
function setView(z, o, animate = true) {
  z = clamp(z, 0.08, 8);
  if (animate && !reducedMotion.matches)
    tween = {
      fromZ: zoom,
      toZ: z,
      fromO: [...origin],
      toO: o,
      time: performance.now(),
      duration: 220,
    };
  else {
    tween = null;
    zoom = z;
    origin = o;
  }
  paint();
}
function fit(animate = true) {
  if (!active) return;
  viewMode = 'fit';
  const [w, h] = stageSize(),
    z = Math.max(
      0.08,
      Math.min(2, (viewport.clientWidth - 140) / w, (viewport.clientHeight - 170) / h),
    );
  setView(
    z,
    [(viewport.clientWidth - w * z) / 2, (viewport.clientHeight - h * z) / 2 - 20],
    animate,
  );
}
function focusSelection() {
  if (!active || !selection.length) return;
  viewMode = 'selection';
  const b = bounds(),
    o = windowOffset(),
    z = clamp(
      Math.min(
        (viewport.clientWidth - 160) / Math.max(b.w, 1),
        (viewport.clientHeight - 180) / Math.max(b.h, 1),
      ),
      0.08,
      4,
    );
  setView(z, [
    viewport.clientWidth / 2 - (b.x + o[0] + b.w / 2) * z,
    viewport.clientHeight / 2 - 20 - (b.y + o[1] + b.h / 2) * z,
  ]);
}
function zoomAt(z, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2, animate = true) {
  viewMode = 'manual';
  const old = zoom;
  z = clamp(z, 0.08, 8);
  setView(z, [x - ((x - origin[0]) * z) / old, y - ((y - origin[1]) * z) / old], animate);
}
function screenPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left - origin[0]) / zoom, (e.clientY - r.top - origin[1]) / zoom];
}
function point(e) {
  const p = screenPoint(e),
    o = windowOffset();
  return p.map((v, i) => v - o[i]);
}
function inside(p, r) {
  return p[0] >= r.x && p[1] >= r.y && p[0] <= r.x + r.w && p[1] <= r.y + r.h;
}
function hit(p) {
  const root = rect(active.node);
  if (!inside(p, root)) return null;
  return [...active.controls]
    .reverse()
    .find((n) => !isHidden(n) && !isLocked(n) && inside(p, rect(n)));
}
function handlePoints(b) {
  return [
    [b.x, b.y],
    [b.x + b.w / 2, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h / 2],
    [b.x + b.w, b.y + b.h],
    [b.x + b.w / 2, b.y + b.h],
    [b.x, b.y + b.h],
    [b.x, b.y + b.h / 2],
  ];
}
function hitHandle(p) {
  if (!selection.length || selection.every(isLocked)) return -1;
  return handlePoints(bounds()).findIndex(
    ([x, y]) => Math.abs(p[0] - x) * zoom <= 5 && Math.abs(p[1] - y) * zoom <= 5,
  );
}
function setTool(next) {
  tool = next;
  $('tool-select').classList.toggle('active', next === 'select');
  $('tool-hand').classList.toggle('active', next === 'hand');
  $('tool-select').setAttribute('aria-pressed', String(next === 'select'));
  $('tool-hand').setAttribute('aria-pressed', String(next === 'hand'));
  viewport.classList.toggle('hand', tool === 'hand' || space);
}
function snapMove(b, dx, dy, exclude) {
  guides = [];
  if (!$('smart-snap').checked) return [dx, dy];
  const targets = [
      rect(active.node),
      ...active.controls.filter((n) => !exclude.includes(n) && !isHidden(n)).map(rect),
    ],
    limit = 5 / zoom;
  for (const axis of ['x', 'y']) {
    const pos = axis === 'x' ? 'x' : 'y',
      size = axis === 'x' ? 'w' : 'h',
      delta = axis === 'x' ? dx : dy;
    let best = limit,
      correction = 0,
      line = null;
    for (const [targetIndex, t] of targets.entries()) {
      for (const v of [t[pos], t[pos] + t[size] / 2, t[pos] + t[size]])
        for (const a of [b[pos] + delta, b[pos] + b[size] / 2 + delta, b[pos] + b[size] + delta]) {
          const distance = Math.abs(v - a);
          if (distance < best) {
            best = distance;
            correction = v - a;
            line = v;
          }
        }
      // Prefer the frame near its edge instead of a coincident decorative control.
      if (targetIndex === 0 && line !== null) break;
    }
    if (line !== null) {
      if (axis === 'x') dx += correction;
      else dy += correction;
      guides.push({ axis, value: line });
    }
  }
  return [dx, dy];
}
canvas.onpointerdown = (e) => {
  if (e.button === 2) return;
  closePopups();
  tween = null;
  viewport.focus();
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || tool === 'hand' || space) {
    e.preventDefault();
    drag = { type: 'pan', client: [e.clientX, e.clientY], origin: [...origin] };
    viewport.classList.add('panning');
    return;
  }
  if (!active) return;
  const p = point(e),
    handle = hitHandle(p);
  let n = hit(p);
  if (handle >= 0) {
    drag = {
      type: 'resize',
      handle,
      p,
      b: bounds(),
      items: selection.map((n) => ({ n, r: rect(n) })),
      committed: false,
      client: [e.clientX, e.clientY],
      origin: [...origin],
      rootPosition: nums(active.node, 'position'),
    };
    return;
  }
  if (n) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelection(selection.includes(n) ? selection.filter((x) => x !== n) : [...selection, n]);
    } else if (!selection.includes(n)) setSelection([n]);
    if (selection.length)
      drag = {
        type: 'move',
        p,
        b: bounds(),
        items: selection.map((n) => ({ n, r: rect(n) })),
        committed: false,
        hit: n,
      };
  } else {
    const before = e.shiftKey ? [...selection] : [];
    if (!e.shiftKey) setSelection([]);
    drag = { type: 'marquee', p, marquee: { x: p[0], y: p[1], w: 0, h: 0 }, before };
  }
};
canvas.onpointermove = (e) => {
  if (!active && !drag) return;
  if (drag?.type === 'pan') {
    viewMode = 'manual';
    origin = [
      drag.origin[0] + e.clientX - drag.client[0],
      drag.origin[1] + e.clientY - drag.client[1],
    ];
    paint();
    return;
  }
  if (drag?.type === 'frame-move') {
    const dx = (e.clientX - drag.client[0]) / zoom,
      dy = (e.clientY - drag.client[1]) / zoom;
    if (!drag.committed && Math.hypot(dx, dy) * zoom < 2) return;
    if (!drag.committed) {
      snapshot(true);
      drag.committed = true;
    }
    edit(
      active.node,
      'position',
      `${Math.round(drag.rootPosition[0] + dx)} ${Math.round(drag.rootPosition[1] + dy)}`,
    );
    if (!$('screen-mode').checked)
      origin = [drag.origin[0] + dx * zoom, drag.origin[1] + dy * zoom];
    syncGeometry();
    source();
    paint();
    return;
  }
  const p = point(e);
  if (!drag) {
    const handle = hitHandle(p),
      n = hit(p);
    canvas.style.cursor =
      tool === 'hand' || space
        ? 'grab'
        : handle >= 0
          ? [
              'nwse-resize',
              'ns-resize',
              'nesw-resize',
              'ew-resize',
              'nwse-resize',
              'ns-resize',
              'nesw-resize',
              'ew-resize',
            ][handle]
          : n
            ? 'default'
            : 'default';
    if (n !== hover) {
      hover = n;
      layerStates();
      paint();
    }
    return;
  }
  const rootResize = drag.type === 'resize' && selected === active.node;
  const dx = rootResize ? (e.clientX - drag.client[0]) / zoom : p[0] - drag.p[0],
    dy = rootResize ? (e.clientY - drag.client[1]) / zoom : p[1] - drag.p[1];
  if (drag.type === 'marquee') {
    drag.marquee = {
      x: Math.min(p[0], drag.p[0]),
      y: Math.min(p[1], drag.p[1]),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
    const r = drag.marquee;
    const nodes = active.controls
      .filter((n) => !isHidden(n) && !isLocked(n))
      .filter((n) => {
        const b = rect(n);
        return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
      });
    setSelection([...drag.before, ...nodes]);
    paint();
    return;
  }
  if (!drag.committed && Math.hypot(dx, dy) * zoom < 2) return;
  if (!drag.committed) {
    snapshot(rootResize);
    drag.committed = true;
  }
  const step = clamp(Number($('snap').value) || 1, 1, 64);
  if (drag.type === 'move') {
    let x = dx,
      y = dy;
    if (e.shiftKey) {
      if (Math.abs(x) > Math.abs(y)) y = 0;
      else x = 0;
    }
    x = Math.round((drag.b.x + x) / step) * step - drag.b.x;
    y = Math.round((drag.b.y + y) / step) * step - drag.b.y;
    if (!e.altKey) [x, y] = snapMove(drag.b, x, y, selection);
    else guides = [];
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) {
        y = 0;
        guides = guides.filter((g) => g.axis === 'x');
      } else {
        x = 0;
        guides = guides.filter((g) => g.axis === 'y');
      }
    }
    for (const { n, r } of drag.items)
      if (!isLocked(n) && n !== active.node)
        edit(n, 'position', `${Math.round(r.x + x)} ${Math.round(r.y + y)}`);
  } else if (drag.type === 'resize') {
    let b = { ...drag.b };
    const h = drag.handle;
    if ([0, 6, 7].includes(h)) {
      b.x += dx;
      b.w -= dx;
    }
    if ([2, 3, 4].includes(h)) b.w += dx;
    if ([0, 1, 2].includes(h)) {
      b.y += dy;
      b.h -= dy;
    }
    if ([4, 5, 6].includes(h)) b.h += dy;
    if (e.shiftKey && [0, 2, 4, 6].includes(h)) {
      const ratio = drag.b.w / drag.b.h;
      b.h = b.w / ratio;
      if ([0, 2].includes(h)) b.y = drag.b.y + drag.b.h - b.h;
    }
    b.w = clamp(Math.round(b.w / step) * step, 1, 32768);
    b.h = clamp(Math.round(b.h / step) * step, 1, 32768);
    if ([0, 6, 7].includes(h)) b.x = drag.b.x + drag.b.w - b.w;
    if ([0, 1, 2].includes(h)) b.y = drag.b.y + drag.b.h - b.h;
    if (rootResize) {
      edit(selected, 'size', `${b.w} ${b.h}`);
      const align = val(active.node, 'alignWin'),
        screen = $('screen-mode').checked;
      const ax = screen
          ? align.includes('RIGHT_X')
            ? 1
            : align.includes('CENTER_X')
              ? 0.5
              : 0
          : 0,
        ay = screen ? (align.includes('BOTTOM_Y') ? 1 : align.includes('CENTER_Y') ? 0.5 : 0) : 0;
      edit(
        selected,
        'position',
        `${Math.round(drag.rootPosition[0] + b.x - drag.b.x + (b.w - drag.b.w) * ax)} ${Math.round(drag.rootPosition[1] + b.y - drag.b.y + (b.h - drag.b.h) * ay)}`,
      );
      if (!screen)
        origin = [
          drag.origin[0] + (b.x - drag.b.x) * zoom,
          drag.origin[1] + (b.y - drag.b.y) * zoom,
        ];
    } else resizeGroup(drag.b, b, drag.items);
  }
  syncGeometry();
  source();
  paint();
};
function syncGeometry() {
  if (!selected) return;
  const b = bounds(),
    p = selection.length === 1 ? nums(selected, 'position') : [b.x, b.y],
    s = selection.length === 1 ? nums(selected, 'size') : [b.w, b.h];
  for (const [label, v] of [
    ['X', p[0]],
    ['Y', p[1]],
    ['Ширина', s[0]],
    ['Высота', s[1]],
  ]) {
    const input = $('fields').querySelector(`[aria-label="${label}"]`);
    if (input) input.value = Math.round(v);
  }
}
function endDrag(e, cancel = false) {
  if (!drag) return;
  const last = drag;
  drag = null;
  viewport.classList.remove('panning');
  guides = [];
  if (cancel && last.committed) {
    const s = undo.pop();
    if (s) restoreState(s);
    if (last.origin) origin = last.origin;
  } else if (
    !cancel &&
    last.type === 'marquee' &&
    last.marquee.w * zoom < 3 &&
    last.marquee.h * zoom < 3 &&
    active &&
    inside(point(e), rect(active.node))
  )
    setSelection([active.node]);
  if (active) {
    layers();
    inspector();
  }
  paint();
}
canvas.onpointerup = (e) => endDrag(e);
canvas.onpointercancel = (e) => endDrag(e, true);
canvas.onlostpointercapture = (e) => {
  if (drag) endDrag(e, true);
};
$('frame-label').onpointerdown = (e) => {
  if (!active || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  setSelection([active.node]);
  tween = null;
  drag = {
    type: 'frame-move',
    client: [e.clientX, e.clientY],
    origin: [...origin],
    rootPosition: nums(active.node, 'position'),
    committed: false,
  };
  canvas.setPointerCapture(e.pointerId);
  viewport.focus();
};
canvas.onpointerleave = () => {
  if (!drag) {
    hover = null;
    if (active) layerStates();
    paint();
  }
};
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    tween = null;
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      zoomAt(zoom * Math.exp(-e.deltaY * 0.008), e.clientX - r.left, e.clientY - r.top, false);
    } else {
      viewMode = 'manual';
      origin[0] -= e.shiftKey ? e.deltaY : e.deltaX;
      origin[1] -= e.shiftKey ? 0 : e.deltaY;
      paint();
    }
  },
  { passive: false },
);
canvas.ondblclick = (e) => {
  if (!active) return;
  const n = hit(point(e));
  if (n) {
    setSelection([n]);
    const input = $('fields').querySelector('[aria-label="Текст или ключ перевода"]');
    if (input) {
      input.focus();
      input.select();
    }
  }
};
function align(mode) {
  const nodes = selection.filter((n) => n !== active.node && !isLocked(n));
  if (!nodes.length) return;
  snapshot();
  const b = nodes.length === 1 ? rect(active.node) : bounds(nodes);
  for (const n of nodes) {
    const r = rect(n);
    let { x, y } = r;
    if (mode === 'left') x = b.x;
    if (mode === 'right') x = b.x + b.w - r.w;
    if (mode === 'center-x') x = b.x + (b.w - r.w) / 2;
    if (mode === 'top') y = b.y;
    if (mode === 'bottom') y = b.y + b.h - r.h;
    if (mode === 'center-y') y = b.y + (b.h - r.h) / 2;
    edit(n, 'position', `${Math.round(x)} ${Math.round(y)}`);
  }
  inspector();
  layers();
}
function distribute(axis) {
  const nodes = selection
    .filter((n) => n !== active.node && !isLocked(n))
    .sort((a, b) => rect(a)[axis] - rect(b)[axis]);
  if (nodes.length < 3) return;
  const size = axis === 'x' ? 'w' : 'h',
    b = bounds(nodes),
    gap = (b[size] - nodes.reduce((s, n) => s + rect(n)[size], 0)) / (nodes.length - 1);
  snapshot();
  let pos = b[axis];
  for (const n of nodes) {
    const r = rect(n);
    r[axis] = pos;
    edit(n, 'position', `${Math.round(r.x)} ${Math.round(r.y)}`);
    pos += r[size] + gap;
  }
  inspector();
}

function scaleWindow(w, factor) {
  for (const n of walk(w.node))
    for (const p of n.props) {
      let v;
      const geometry = [
        'position',
        'size',
        'recttitle',
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
      ];
      if (geometry.includes(p.key.toLowerCase()))
        v = p.value
          .split(/\s+/)
          .map((x) => Math.round(Number(x) * factor))
          .join(' ');
      if (p.key.toLowerCase() === 'size' && n.kind !== 'windowUI' && get(n, 'position')) {
        const position = get(n, 'position').value.split(/\s+/).map(Number);
        v = p.value
          .split(/\s+/)
          .map(
            (x, i) =>
              Math.round((position[i] + Number(x)) * factor) - Math.round(position[i] * factor),
          )
          .join(' ');
      }
      if (p.key === 'texture') {
        const tokens = p.value.match(/"[^"]*"|\S+/g);
        if (tokens.length >= 9)
          v = [
            ...tokens.slice(0, 5),
            ...tokens.slice(5).map((x) => Math.round(Number(x) * factor)),
          ].join(' ');
      }
      if (['showEffect', 'hideEffect'].includes(p.key) && p.value.trim().startsWith('MOVE_')) {
        const tokens = p.value.trim().split(/\s+/);
        v = [
          ...tokens.slice(0, 2),
          ...tokens.slice(2).map((x) => Math.round(Number(x) * factor)),
        ].join(' ');
      }
      if (v && !v.includes('NaN')) {
        const k = keyFor(w.file, p);
        if (v === p.value) edits.delete(k);
        else
          edits.set(k, {
            file: w.file.name,
            node: n.id,
            key: p.key,
            start: p.start,
            end: p.end,
            value: v,
          });
      }
    }
}

function navTab(name) {
  for (const tab of ['layers', 'windows']) {
    $('tab-' + tab).classList.toggle('active', tab === name);
    $('tab-' + tab).setAttribute('aria-selected', String(tab === name));
    $(tab + '-panel').hidden = tab !== name;
  }
}
function inspectorTab(name) {
  for (const tab of ['design', 'code']) {
    $('tab-' + tab).classList.toggle('active', tab === name);
    $('tab-' + tab).setAttribute('aria-selected', String(tab === name));
    $(tab + '-panel').hidden = tab !== name;
  }
}
function closePopups() {
  document.querySelectorAll('.popup').forEach((p) => (p.hidden = true));
}
function popup(id, anchor) {
  const p = $(id),
    was = p.hidden;
  closePopups();
  if (!was) return;
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = clamp(r.right - p.offsetWidth, 8, innerWidth - p.offsetWidth - 8) + 'px';
  p.style.top = (id === 'zoom-popup' ? r.top - p.offsetHeight - 12 : r.bottom + 8) + 'px';
}
function openDialog(id) {
  closePopups();
  if (!$(id).open) $(id).showModal();
}
function copyProperties() {
  if (!selected) return;
  clipboard = selection.map((n) =>
    n.props
      .filter((p) =>
        [
          'position',
          'size',
          'font',
          'textcolor',
          'focuscolor',
          'disabledcolor',
          'textformat',
          'windowtext',
          'alignwin',
        ].includes(p.key.toLowerCase()),
      )
      .map((p) => ({ key: p.key, value: edits.get(keyFor(active.file, p))?.value ?? p.value })),
  );
  toast(`Скопированы свойства: ${selection.length}`);
}
function pasteProperties() {
  if (!clipboard || !selection.length) return;
  snapshot();
  selection
    .filter((n) => !isLocked(n))
    .forEach((n, i) => {
      for (const p of clipboard[i % clipboard.length]) if (get(n, p.key)) edit(n, p.key, p.value);
    });
  layers();
  inspector();
}
canvas.oncontextmenu = (e) => {
  e.preventDefault();
  if (!active) return;
  const n = hit(point(e));
  if (n && !selection.includes(n)) setSelection([n]);
  closePopups();
  const menu = $('context-menu');
  menu.replaceChildren();
  for (const [label, glyph, fn, key] of [
    ['Приблизить выделение', 'focus', focusSelection, 'Shift 2'],
    ['Вписать окно', 'fit', fit, 'Shift 1'],
    ['Копировать свойства', 'copy', copyProperties, 'Ctrl Alt C'],
    ['Вставить свойства', 'paste', pasteProperties, 'Ctrl Alt V'],
    ['Выровнять слева', 'align-left', () => align('left'), ''],
    ['Выровнять сверху', 'align-top', () => align('top'), ''],
  ]) {
    const b = el('button', '', label);
    b.prepend(icon(glyph));
    if (key) b.append(el('kbd', '', key));
    b.onclick = () => {
      closePopups();
      fn();
    };
    if (label.startsWith('Вставить')) b.disabled = !clipboard || !selected;
    menu.append(b);
  }
  menu.hidden = false;
  menu.style.left = clamp(e.clientX, 8, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = clamp(e.clientY, 8, innerHeight - menu.offsetHeight - 8) + 'px';
};
document.addEventListener('pointerdown', (e) => {
  if (
    !e.target.closest('.popup') &&
    !e.target.closest('#main-menu,#view-open,#scale-open,#zoom-label')
  )
    closePopups();
});
document
  .querySelectorAll('[data-close]')
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
document.querySelectorAll('dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        d.close();
    }
  }),
);
$('tab-layers').onclick = () => navTab('layers');
$('tab-windows').onclick = () => navTab('windows');
$('tab-design').onclick = () => inspectorTab('design');
$('tab-code').onclick = () => inspectorTab('code');
$('tool-select').onclick = () => setTool('select');
$('tool-hand').onclick = () => setTool('hand');
$('undo').onclick = () => {
  if (undo.length) {
    const previous = undo.pop();
    redo.push(state(!!previous.frameView));
    restoreState(previous);
  }
};
$('redo').onclick = () => {
  if (redo.length) {
    const next = redo.pop();
    undo.push(state(!!next.frameView));
    restoreState(next);
  }
};
$('zoom-in').onclick = () => zoomAt(zoom * 1.25);
$('zoom-out').onclick = () => zoomAt(zoom * 0.8);
$('fit').onclick = () => fit();
$('selection-focus').onclick = focusSelection;
$('main-menu').onclick = () => popup('main-popup', $('main-menu'));
$('view-open').onclick = () => popup('view-popup', $('view-open'));
$('scale-open').onclick = () => popup('scale-popup', $('scale-open'));
$('zoom-label').onclick = () => popup('zoom-popup', $('zoom-label'));
$('zoom-fit').onclick = () => {
  fit();
  closePopups();
};
$('zoom-selection').onclick = () => {
  focusSelection();
  closePopups();
};
document.querySelectorAll('[data-zoom]').forEach(
  (b) =>
    (b.onclick = () => {
      zoomAt(Number(b.dataset.zoom));
      closePopups();
    }),
);
for (const id of ['bounds', 'grid', 'smart-snap']) $(id).onchange = paint;
$('screen-mode').onchange = () => fit();
$('resolution').onchange = () => fit();
$('elements').onchange = () => {
  const n = [active.node, ...active.controls].find((n) => n.id === $('elements').value);
  if (n) setSelection([n]);
};
$('search').oninput = list;
$('layer-search').oninput = layers;
document.querySelectorAll('[data-filter]').forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll('[data-filter]')
        .forEach((x) => x.classList.toggle('active', x === b));
      list();
    }),
);
document
  .querySelectorAll('[data-align]')
  .forEach((b) => (b.onclick = () => align(b.dataset.align)));
$('reset').onclick = () => {
  if (!active) return;
  snapshot();
  const starts = new Set(
    walk(active.node)
      .flatMap((n) => n.props)
      .map((p) => p.start),
  );
  for (const [k, e] of edits)
    if (e.file === active.file.name && starts.has(e.start)) edits.delete(k);
  list();
  layers();
  inspector();
  updateDirty();
  fit();
};
$('scale-window').onclick = () => {
  if (!active) return;
  snapshot();
  scaleWindow(active, Number($('scale').value));
  layers();
  inspector();
  list();
  updateDirty();
  fit();
  closePopups();
};
$('scale-all').onclick = () => {
  if (!active) return;
  snapshot();
  const f = Number($('scale').value);
  for (const w of windows) if (w.file.name !== 'loadscreen.ui') scaleWindow(w, f);
  for (const file of data.files)
    if (!walk(file.tree).some((n) => n.kind === 'windowUI'))
      scaleWindow({ file, node: file.tree }, f);
  layers();
  inspector();
  list();
  updateDirty();
  fit();
  closePopups();
  toast('Размеры рассчитаны от прочитанных файлов, без накопления');
};
$('save').onclick = guarded(async () => {
  if ($('client-path').value !== data.client) throw Error('Сначала откройте выбранную копию игры');
  const files = data.files.filter(changed).map((file) => ({
    name: file.name,
    hash: file.hash,
    edits: [...edits.values()]
      .filter((e) => e.file === file.name)
      .map(({ start, end, value }) => ({ start, end, value })),
  }));
  $('save').disabled = true;
  try {
    const result = await api('/api/save', { files, client: data.client }),
      name = active.name,
      ids = selection.map((n) => n.id);
    for (const f of result.files) data.files[data.files.findIndex((x) => x.name === f.name)] = f;
    edits.clear();
    undo = [];
    redo = [];
    rebuild();
    choose(windows.find((w) => w.name === name) || windows[0], false);
    setSelection([active.node, ...active.controls].filter((n) => ids.includes(n.id)));
    toast(
      result.downloadOnly
        ? 'Скачан ZIP с изменениями и бэкапами. Распакуйте его в папку клиента.'
        : `Сохранено файлов: ${result.files.length}. Резервная копия создана. Перезапустите игру`,
    );
  } finally {
    updateDirty();
  }
});
$('history').onclick = guarded(async () => {
  const ids = await api('/api/backups');
  $('backup-list').replaceChildren();
  if (!ids.length)
    $('backup-list').append(
      el('div', 'empty-list', 'Резервные копии появятся после первого сохранения.'),
    );
  for (const id of ids) {
    const row = el('div', 'backup'),
      date = new Date(id.slice(0, 19).replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3') + 'Z'),
      text = el('span', '', date.toLocaleString('ru-RU'));
    text.append(el('small', '', 'Изменённые файлы интерфейса'));
    const b = el('button', '', 'Восстановить');
    b.onclick = guarded(async () => {
      if (edits.size && !confirm('Откатить файлы и убрать несохранённые изменения?')) return;
      const restored = await api('/api/restore', { id, client: data.client });
      edits.clear();
      undo = [];
      redo = [];
      await load(active?.name);
      $('backup-dialog').close();
      toast(
        restored.downloadOnly
          ? 'Скачан ZIP для восстановления файлов. Распакуйте его в папку клиента.'
          : 'Исходные файлы восстановлены',
      );
    });
    row.append(text, b);
    $('backup-list').append(row);
  }
  openDialog('backup-dialog');
});
$('close-dialog').onclick = () => $('backup-dialog').close();
$('menu-history').onclick = () => $('history').click();
$('export').onclick = () => {
  if (!data?.files.length) return;
  const allowed = new Set([
    'position',
    'size',
    'recttitle',
    'font',
    'textcolor',
    'focuscolor',
    'disabledcolor',
    'backcolor',
    'alignwin',
    'textformat',
    'drawmethod',
    'windowtext',
    'showeffect',
    'hideeffect',
    'escapehandle',
    'cannotcross',
    'hittransparent',
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
  ]);
  const settings = [];
  for (const file of data.files)
    for (const node of walk(file.tree))
      for (const p of node.props)
        if (allowed.has(p.key.toLowerCase()))
          settings.push({
            file: file.name,
            node: node.id,
            key: p.key,
            occurrence: node.props.filter((x) => x.key === p.key).indexOf(p),
            value: edits.get(keyFor(file, p))?.value ?? p.value,
          });
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ format: 'sphere-ui-profile-v1', edits: settings }, null, 2)], {
      type: 'application/json',
    }),
  );
  const a = el('a');
  a.href = url;
  a.download = 'sphere-interface.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Профиль содержит текущее оформление всех окон');
};
$('import').onclick = () => $('profile').click();
$('profile').onchange = guarded(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const profile = JSON.parse(await file.text());
  if (profile.format !== 'sphere-ui-profile-v1' || !Array.isArray(profile.edits))
    throw Error('Это не профиль интерфейса Сферы');
  const batch = [];
  for (const edit of profile.edits) {
    const target = data.files.find((f) => f.name === edit.file),
      node = target && walk(target.tree).find((n) => n.id === edit.node);
    if (!node || !get(node, edit.key, edit.occurrence || 0) || typeof edit.value !== 'string')
      throw Error(`Профиль не подходит к файлу ${edit.file}`);
    batch.push({ edit, target, node });
  }
  snapshot();
  batchEdit(() => {
    for (const { edit: e, target, node } of batch)
      edit(node, e.key, e.value, target, e.occurrence || 0);
  });
  list();
  layers();
  inspector();
  fit();
  toast(`Профиль загружен: ${batch.length} полей. Сохраните, чтобы применить`);
  e.target.value = '';
});
$('research').onclick = () => window.open(storage.research, '_blank', 'noopener');
async function recentClients(extra = []) {
  const roots = [
    ...new Map(
      [...extra, ...(await api('/api/clients'))].map((root) => {
        const item =
          typeof root === 'string'
            ? { id: root, name: root.split(/[\\/]/).filter(Boolean).at(-1), display: root }
            : root;
        return [item.id, item];
      }),
    ).values(),
  ];
  $('client-choice').replaceChildren(new Option('Недавние копии', ''));
  $('recent-clients').replaceChildren();
  $('recent-caption').hidden = !roots.length;
  for (const root of roots) {
    $('client-choice').append(new Option(root.display, root.id));
    const b = el('button', 'recent-client');
    b.append(icon('folder'));
    const text = el('span');
    text.append(el('strong', '', root.name), el('small', '', root.display));
    b.append(text);
    if (root.id === data?.client) b.append(el('small', 'current-badge', 'ОТКРЫТА'));
    b.onclick = () => {
      $('client-path').value = root.id;
      $('browser-folder-name').textContent = root.name;
      $('connect-client').click();
    };
    $('recent-clients').append(b);
  }
}
async function openClient() {
  openDialog('client-dialog');
  $('client-path').value = data?.client || '';
  $('discovery-status').textContent = '';
  await recentClients();
}
for (const id of ['client-open', 'welcome-open', 'menu-client'])
  $(id).onclick = guarded(openClient);
$('browse-client').onclick = guarded(async () => {
  if (storage.mode === 'browser' && !globalThis.showDirectoryPicker) {
    $('folder-files').click();
    return;
  }
  const b = $('browse-client');
  b.disabled = true;
  try {
    const result = await api('/api/pick-folder', {});
    if (result.path) {
      $('client-path').value = result.path;
      $('browser-folder-name').textContent = result.name || result.path;
      updateDirty();
    }
  } finally {
    b.disabled = false;
  }
});
$('discover-clients').onclick = guarded(async () => {
  const b = $('discover-clients');
  b.disabled = true;
  $('discovery-status').textContent = 'Ищем копии только внутри указанной папки…';
  try {
    const result = await api('/api/discover', { path: $('client-path').value });
    await recentClients(result.paths);
    $('discovery-status').textContent =
      `Найдено копий: ${result.paths.length}. Просмотрено папок: ${result.visited}.${result.limited ? ' Поиск ограничен первыми 2000 папок.' : ''}`;
  } finally {
    b.disabled = false;
  }
});
$('connect-client').onclick = guarded(async () => {
  if (edits.size && !confirm('Переключить копию игры и убрать несохранённые изменения?')) return;
  await api('/api/client', { path: $('client-path').value });
  edits.clear();
  undo = [];
  redo = [];
  visibility.clear();
  locked.clear();
  views.clear();
  await load();
  $('client-dialog').close();
  toast('Открыта копия: ' + (data.clientLabel || data.client));
});
$('client-path').oninput = updateDirty;
if (storage.mode === 'browser') {
  $('client-path').hidden = true;
  $('browser-folder-name').hidden = false;
  $('storage-description').hidden = false;
  $('storage-description').textContent = globalThis.showDirectoryPicker
    ? 'Выберите папку и разрешите запись. Сохранение и резервные копии выполняются на вашем компьютере. Игровые файлы не отправляются на сайт.'
    : 'Этот браузер открывает папку для редактирования с выгрузкой изменений и бэкапов в ZIP. Для прямой записи используйте Chrome, Edge или локальную версию.';
  $('import-folder').hidden = !globalThis.showDirectoryPicker;
}
$('import-folder').onclick = () => $('folder-files').click();
$('folder-files').onchange = guarded(async (event) => {
  if (!event.target.files.length) return;
  if (edits.size && !confirm('Открыть другую папку и убрать несохранённые изменения?')) return;
  await storage.importFiles([...event.target.files]);
  edits.clear();
  undo = [];
  redo = [];
  visibility.clear();
  locked.clear();
  views.clear();
  await load();
  $('client-dialog').close();
  toast('Папка открыта. Изменения будут скачиваться в ZIP, файлы на диске пока не меняются.');
  event.target.value = '';
});
$('client-dialog').addEventListener('close', () => {
  $('client-path').value = data?.client || '';
  updateDirty();
});
$('client-choice').onchange = () => {
  if ($('client-choice').value) {
    $('client-path').value = $('client-choice').value;
    updateDirty();
  }
};
const commands = () => [
  { label: 'Открыть папку игры', icon: 'folder', run: guarded(openClient) },
  { label: 'Сохранить в клиент', icon: 'check', key: 'Ctrl S', run: () => $('save').click() },
  { label: 'Вписать окно', icon: 'fit', key: 'Shift 1', run: () => fit() },
  { label: 'Приблизить выделение', icon: 'focus', key: 'Shift 2', run: focusSelection },
  { label: 'Отменить', icon: 'undo', key: 'Ctrl Z', run: () => $('undo').click() },
  { label: 'Повторить', icon: 'redo', key: 'Ctrl Shift Z', run: () => $('redo').click() },
  { label: 'Резервные копии', icon: 'history', run: () => $('history').click() },
  {
    label: 'Горячие клавиши',
    icon: 'keyboard',
    key: '?',
    run: () => openDialog('shortcuts-dialog'),
  },
  ...windows.map((w) => ({
    label: w.title,
    sub: `${w.name} · ${w.file.name}`,
    icon: 'frame',
    run: () => {
      choose(w);
      navTab('layers');
    },
  })),
];
function commandResults() {
  const query = $('command-search').value.toLowerCase();
  commandItems = commands().filter((c) =>
    `${c.label} ${c.sub || ''}`.toLowerCase().includes(query),
  );
  commandIndex = 0;
  $('command-results').replaceChildren();
  for (const [index, c] of commandItems.entries()) {
    const b = el('button', 'command-item');
    b.setAttribute('role', 'option');
    b.append(icon(c.icon));
    const text = el('span', '', c.label);
    if (c.sub) text.append(el('small', '', c.sub));
    b.append(text);
    if (c.key) b.append(el('kbd', '', c.key));
    b.onclick = () => {
      $('command-dialog').close();
      c.run();
    };
    b.onpointermove = () => {
      commandIndex = index;
      commandHighlight();
    };
    $('command-results').append(b);
  }
  if (!commandItems.length)
    $('command-results').append(el('div', 'empty-list', 'Ничего не найдено'));
  commandHighlight();
}
function commandHighlight() {
  [...$('command-results').children].forEach((b, i) => {
    b.classList.toggle('active', i === commandIndex);
    b.setAttribute('aria-selected', String(i === commandIndex));
  });
}
function openCommands() {
  openDialog('command-dialog');
  $('command-search').value = '';
  commandResults();
  $('command-search').focus();
}
$('command-open').onclick = openCommands;
$('frame-picker').onclick = openCommands;
$('command-search').oninput = commandResults;
$('command-search').onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    commandIndex = clamp(
      commandIndex + (e.key === 'ArrowDown' ? 1 : -1),
      0,
      Math.max(0, commandItems.length - 1),
    );
    commandHighlight();
    $('command-results').children[commandIndex]?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter' && commandItems[commandIndex]) {
    e.preventDefault();
    $('command-dialog').close();
    commandItems[commandIndex].run();
  }
};
const shortcuts = [
  ['Выделение', ['V']],
  ['Рука / перемещение холста', ['H', 'Пробел + мышь']],
  ['Быстрые команды', ['Ctrl', 'K']],
  ['Сохранить в клиент', ['Ctrl', 'S']],
  ['Отменить / повторить', ['Ctrl', 'Z / Shift Z']],
  ['Выделить все видимые элементы', ['Ctrl', 'A']],
  ['Добавить к выделению', ['Shift', 'клик']],
  ['Сдвинуть на 1 / 10 px', ['↑ ↓ ← →', 'Shift']],
  ['Вписать окно / выделение', ['Shift', '1 / 2']],
  ['Масштаб холста', ['Ctrl', 'колёсико']],
  ['Копировать / вставить свойства', ['Ctrl Alt', 'C / V']],
  ['Убрать выделение', ['Esc']],
];
for (const [label, keys] of shortcuts) {
  const row = el('div', 'shortcut-row'),
    group = el('span');
  keys.forEach((k) => group.append(el('kbd', '', k)));
  row.append(el('span', '', label), group);
  $('shortcuts-list').append(row);
}
$('shortcuts-open').onclick = () => openDialog('shortcuts-dialog');
$('menu-shortcuts').onclick = () => openDialog('shortcuts-dialog');
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName),
    mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyK') {
    e.preventDefault();
    if ($('command-dialog').open) $('command-dialog').close();
    else openCommands();
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (mod && e.code === 'KeyS') {
    e.preventDefault();
    $('save').click();
    return;
  }
  if (typing) return;
  if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    $(e.shiftKey ? 'redo' : 'undo').click();
    return;
  }
  if (mod && e.code === 'KeyY') {
    e.preventDefault();
    $('redo').click();
    return;
  }
  if (mod && e.altKey && e.code === 'KeyC') {
    e.preventDefault();
    copyProperties();
    return;
  }
  if (mod && e.altKey && e.code === 'KeyV') {
    e.preventDefault();
    pasteProperties();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    space = true;
    viewport.classList.add('hand');
    return;
  }
  if (e.key === 'Escape') {
    closePopups();
    if (drag) endDrag(null, true);
    if (active) setSelection([]);
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    openDialog('shortcuts-dialog');
    return;
  }
  if (!mod && e.code === 'KeyV') {
    setTool('select');
    return;
  }
  if (!mod && e.code === 'KeyH') {
    setTool('hand');
    return;
  }
  if (e.shiftKey && e.code === 'Digit1') {
    e.preventDefault();
    fit();
    return;
  }
  if (e.shiftKey && e.code === 'Digit2') {
    e.preventDefault();
    focusSelection();
    return;
  }
  if (mod && e.code === 'Digit0') {
    e.preventDefault();
    zoomAt(1);
    return;
  }
  if (!active) return;
  if (mod && e.code === 'KeyA') {
    e.preventDefault();
    setSelection(active.controls.filter((n) => !isHidden(n) && !isLocked(n)));
    return;
  }
  if (e.code === 'KeyB' && !mod) {
    $('bounds').checked = !$('bounds').checked;
    paint();
    return;
  }
  if (e.code === 'KeyG' && !mod) {
    $('grid').checked = !$('grid').checked;
    paint();
    return;
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && selection.length) {
    e.preventDefault();
    const movable = selection.filter((n) => n !== active.node && !isLocked(n));
    if (!movable.length) return;
    if (!e.repeat) snapshot();
    const axis = ['ArrowLeft', 'ArrowRight'].includes(e.key) ? 0 : 1,
      delta = (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) * (e.shiftKey ? 10 : 1);
    for (const n of movable) {
      const p = nums(n, 'position');
      p[axis] += delta;
      edit(n, 'position', p.join(' '));
    }
    syncGeometry();
    source();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    space = false;
    viewport.classList.toggle('hand', tool === 'hand');
  }
});
window.addEventListener('blur', () => {
  space = false;
  viewport.classList.remove('panning');
  viewport.classList.toggle('hand', tool === 'hand');
  if (drag) endDrag(null, true);
});
window.onbeforeunload = (e) => {
  if (edits.size) {
    e.preventDefault();
    e.returnValue = '';
  }
};
let oldViewport;
new ResizeObserver(() => {
  const next = [viewport.clientWidth, viewport.clientHeight];
  if (oldViewport && active) {
    if (viewMode === 'fit') fit(false);
    else {
      origin[0] += (next[0] - oldViewport[0]) / 2;
      origin[1] += (next[1] - oldViewport[1]) / 2;
      tween = null;
    }
  }
  oldViewport = next;
  paint();
}).observe(viewport);
async function load(preferred = 'pick_person') {
  data = await api('/api/catalog');
  $('client').textContent = 'Клиент';
  $('client-path').value = data.client || '';
  $('client-summary').textContent = data.clientLabel || data.client || 'Выберите папку игры';
  $('client-summary').title = data.clientLabel || data.client || '';
  if (storage.mode === 'browser')
    $('browser-folder-name').textContent = data.clientLabel || 'Выберите папку кнопкой справа';
  $('save').querySelector('span:last-child').textContent =
    data.storageMode === 'download' ? 'Скачать изменения' : 'Сохранить в клиент';
  $('storage-mode').textContent =
    storage.mode === 'browser'
      ? data.storageMode === 'download'
        ? 'Онлайн · выгрузка в ZIP'
        : 'Онлайн · файлы у вас'
      : 'Локальный проект';
  images.clear();
  rebuild();
  if (windows.length) choose(windows.find((w) => w.name === preferred) || windows[0], false);
  else {
    active = null;
    selected = null;
    selection = [];
    $('empty-state').hidden = false;
    $('frame-label').hidden = true;
    $('title').textContent = 'Интерфейс игры';
    $('fields').replaceChildren();
    $('layers').replaceChildren();
    $('windows').replaceChildren();
    $('elements').replaceChildren();
    $('selected-name').textContent = 'Холст';
    $('selected-meta').textContent = 'Откройте папку клиента';
    paint();
  }
  updateDirty();
}
guarded(load)();
