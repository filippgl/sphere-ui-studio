import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode, parse, walk, prop, hash } from './ui-model.mjs';

export async function browserChecks({
  browser,
  url,
  check,
  fixture,
  effects,
  file,
  baseWidth,
  baseHeight,
  request,
}) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.paintedText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.paintedText.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  const waitView = () => page.waitForTimeout(260);
  const field = (name) => page.getByLabel(name, { exact: true });
  const value = async (name) => Number(await field(name).inputValue());
  const layer = (index) => page.locator('.layer').nth(index);
  const select = async (index) => {
    if (await page.locator('#elements').isEnabled())
      await page.locator('#elements').selectOption({ index });
    else await layer(index).click();
  };
  const openWindow = async (name) => {
    await page.keyboard.press('Control+k');
    await page.locator('#command-search').fill(name);
    await page.locator('.command-item').first().click();
    await waitView();
  };
  const frame = async () => {
    const label = await page.locator('#frame-label').boundingBox();
    return {
      x: label.x,
      y: label.y + label.height,
      z: parseInt(await page.locator('#zoom-label').textContent()) / 100,
    };
  };
  const popup = async (button, id) => {
    if (!(await page.locator(id).isVisible())) await page.locator(button).click();
  };
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.layer').length > 1);
  await waitView();
  check(
    (await page.locator('#client-summary').textContent()) === (await fs.realpath(fixture)),
    'В рабочей области виден путь к выбранному клиенту',
  );
  await page.locator('#tab-windows').click();
  check((await page.locator('.window-item').count()) === 93, 'Все окна доступны в навигаторе');
  await page.locator('#tab-layers').click();
  check(
    (await page.locator('.layer').count()) === 85,
    'Для окна персонажа показаны все 84 слоя и рамка',
  );

  await openWindow('Альянсы и войны');
  check(
    await page
      .locator('.layer')
      .nth(7)
      .getAttribute('class')
      .then((s) => s.includes('is-hidden')),
    'Скрытая заготовка из скриншота помечена скрытой',
  );
  check(
    await page.evaluate(() => !window.paintedText.some((t) => t.includes('UISTR_'))),
    'Служебные ключи перевода не рисуются на холсте',
  );
  check(
    await page.evaluate(() => window.paintedText.some((t) => t.includes('Заключить альянс'))),
    'Вместо ключей отображаются русские подписи',
  );
  await select(7);
  check(
    await page
      .locator('#selection-notes')
      .textContent()
      .then((t) => t.includes('скрыт в клиенте')),
    'Объясняется скрытое состояние заготовки',
  );
  check(
    await page
      .locator('#fields')
      .textContent()
      .then((t) => t.includes('Нет перевода')),
    'Неизвестный ключ объясняется в инспекторе',
  );
  await layer(7)
    .getByRole('button', { name: /^Видимость:/ })
    .click();
  check(
    await page.evaluate(() => !window.paintedText.some((t) => t.includes('UISTR_'))),
    'Принудительный показ скрытого элемента не выводит неизвестный ключ',
  );
  check(await page.locator('#save').isDisabled(), 'Просмотр скрытого слоя не меняет файлы игры');

  await openWindow('Выбор персонажа');
  await popup('#view-open', '#view-popup');
  await page.locator('#smart-snap').uncheck();
  await page.locator('#view-open').click();
  await select(1);
  const start = {
    x: await value('X'),
    y: await value('Y'),
    w: await value('Ширина'),
    h: await value('Высота'),
  };
  let f = await frame();
  let cx = f.x + (start.x + start.w / 2) * f.z,
    cy = f.y + (start.y + start.h / 2) * f.z;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20 * f.z, cy + 10 * f.z, { steps: 8 });
  await page.mouse.up();
  check(
    Math.abs((await value('X')) - start.x - 20) <= 1 &&
      Math.abs((await value('Y')) - start.y - 10) <= 1,
    'Маленькую кнопку можно точно перетаскивать',
  );
  await page.locator('#viewport').press('Shift+ArrowRight');
  check(
    Math.abs((await value('X')) - start.x - 30) <= 1,
    'Shift со стрелкой сдвигает на 10 пикселей',
  );
  await page.keyboard.press('Control+z');
  check(Math.abs((await value('X')) - start.x - 20) <= 1, 'Ctrl Z отменяет шаг клавиатуры');
  await page.keyboard.press('Control+Shift+z');
  check(
    Math.abs((await value('X')) - start.x - 30) <= 1,
    'Ctrl Shift Z возвращает отменённое действие',
  );
  await page.locator('#reset').click();
  await waitView();

  await layer(2).click();
  const a = { x: await value('X'), y: await value('Y') };
  await layer(3).click({ modifiers: ['Control'] });
  check(
    (await page.locator('.layer.active').count()) === 2,
    'Ctrl клик добавляет слой к выделению',
  );
  check(
    (await page.locator('#selected-name').textContent()) === '2 элементов',
    'Инспектор показывает совместное редактирование',
  );
  await page.locator('#viewport').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await layer(2).click();
  check((await value('X')) === a.x + 10, 'Групповое перемещение меняет первый элемент');
  await layer(3).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Выровнять по левому краю', exact: true }).click();
  await layer(2).click();
  const alignedX = await value('X');
  await layer(3).click();
  check((await value('X')) === alignedX, 'Выравнивание нескольких элементов работает');
  await page.locator('#reset').click();
  await waitView();

  await layer(2).click();
  const textWidth = await value('Ширина');
  await layer(3).click({ modifiers: ['Control'] });
  const group = {
    x: await value('X'),
    y: await value('Y'),
    w: await value('Ширина'),
    h: await value('Высота'),
  };
  f = await frame();
  const groupCorner = [f.x + (group.x + group.w) * f.z, f.y + (group.y + group.h) * f.z];
  await page.mouse.move(...groupCorner);
  await page.mouse.down();
  await page.mouse.move(groupCorner[0] + 20 * f.z, groupCorner[1] + 10 * f.z, { steps: 6 });
  await page.mouse.up();
  check(
    Math.abs((await value('Ширина')) - group.w - 20) <= 1,
    'Групповой ресайз изменяет общую рамку',
  );
  await layer(2).click();
  check((await value('Ширина')) > textWidth, 'Групповой ресайз меняет размеры дочернего элемента');
  await page.locator('#undo').click();
  await layer(2).click();
  check(
    (await value('Ширина')) === textWidth,
    'Отмена группового ресайза восстанавливает дочерние размеры',
  );

  await field('Шрифт').selectOption('5');
  await page.locator('#viewport').focus();
  await page.keyboard.press('Control+Alt+c');
  await layer(3).click();
  const oldFont = await field('Шрифт').inputValue();
  await page.locator('#viewport').focus();
  await page.keyboard.press('Control+Alt+v');
  check(
    (await field('Шрифт').inputValue()) === '5',
    'Свойства переносятся между существующими элементами',
  );
  await page.locator('#undo').click();
  check((await field('Шрифт').inputValue()) === oldFont, 'Вставку свойств можно отменить');
  await page.locator('#reset').click();
  await waitView();

  const positions = [20, 70, 200],
    items = [];
  for (const [i, index] of [2, 3, 4].entries()) {
    await layer(index).click();
    await field('Y').fill(String(positions[i]));
    await field('Y').press('Tab');
    items.push({ y: await value('Y'), h: await value('Высота') });
  }
  await layer(2).click();
  await layer(3).click({ modifiers: ['Control'] });
  await layer(4).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Распределить по вертикали', exact: true }).click();
  await layer(3).click();
  const gap = (items[2].y + items[2].h - items[0].y - items.reduce((sum, r) => sum + r.h, 0)) / 2;
  check(
    Math.abs((await value('Y')) - items[0].y - items[0].h - gap) <= 1,
    'Распределение задаёт равные промежутки между элементами',
  );
  await page.locator('#reset').click();
  await waitView();

  await popup('#view-open', '#view-popup');
  await page.locator('#smart-snap').check();
  await page.locator('#view-open').click();
  await select(1);
  f = await frame();
  const nearEdge = {
    x: await value('X'),
    y: await value('Y'),
    w: await value('Ширина'),
    h: await value('Высота'),
  };
  await page.mouse.move(
    f.x + (nearEdge.x + nearEdge.w / 2) * f.z,
    f.y + (nearEdge.y + nearEdge.h / 2) * f.z,
  );
  await page.mouse.down();
  await page.mouse.move(
    f.x + (nearEdge.w / 2 + 2) * f.z,
    f.y + (nearEdge.y + nearEdge.h / 2) * f.z,
    { steps: 8 },
  );
  await page.mouse.up();
  check(
    (await value('X')) === 0,
    `Умные направляющие привязывают элемент к краю окна: X=${await value('X')}`,
  );
  await page.locator('#reset').click();
  await waitView();

  await select(1);
  await layer(1)
    .getByRole('button', { name: /^Блокировка:/ })
    .click();
  check(await field('X').isDisabled(), 'Заблокированный слой защищён от редактирования');
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  check((await value('X')) === start.x, 'Стрелки не перемещают заблокированный слой');
  await layer(1)
    .getByRole('button', { name: /^Блокировка:/ })
    .click();
  check(await field('X').isEnabled(), 'Снятие блокировки возвращает редактирование');
  await layer(2).click();
  await layer(5).click({ modifiers: ['Shift'] });
  check(
    (await page.locator('.layer.active').count()) === 4,
    'Shift выделяет диапазон в списке слоёв',
  );
  await select(0);
  await page.locator('#fit').click();
  await waitView();
  f = await frame();
  await page.mouse.move(f.x - 12, f.y - 12);
  await page.mouse.down();
  await page.mouse.move(f.x + baseWidth * f.z + 12, f.y + baseHeight * f.z + 12, { steps: 12 });
  await page.mouse.up();
  check(
    (await page.locator('.layer.active').count()) > 2,
    'Рамкой на холсте можно выделить несколько элементов',
  );
  check(
    !(await layer(0).getAttribute('class')).includes('active'),
    'Рамка окна не включается в групповое выделение дочерних элементов',
  );

  await select(0);
  await page.locator('#fit').click();
  await waitView();
  f = await frame();
  await page.mouse.move(f.x + baseWidth * f.z, f.y + baseHeight * f.z);
  await page.mouse.down();
  await page.mouse.move(f.x + (baseWidth + 30) * f.z, f.y + (baseHeight + 20) * f.z, { steps: 10 });
  await page.mouse.up();
  check(
    Math.abs((await value('Ширина')) - baseWidth - 30) <= 1,
    'Рамка меняет размер за угловой маркер',
  );
  await page.locator('#undo').click();
  check((await value('Ширина')) === baseWidth, 'Изменение размера отменяется одним шагом');
  const rootX = await value('X'),
    labelBefore = await page.locator('#frame-label').boundingBox();
  await page.mouse.move(labelBefore.x + 30, labelBefore.y + 3);
  await page.mouse.down();
  await page.mouse.move(labelBefore.x + 60, labelBefore.y + 23, { steps: 5 });
  await page.mouse.up();
  check(
    Math.abs((await value('X')) - rootX - 30 / f.z) <= 1,
    'Окно перемещается за заголовок рамки',
  );
  await page.locator('#undo').click();
  const labelAfterUndo = await page.locator('#frame-label').boundingBox();
  check(
    Math.abs(labelAfterUndo.x - labelBefore.x) < 2,
    'Отмена перемещения окна восстанавливает его положение на холсте',
  );
  await page.mouse.move(labelAfterUndo.x + 30, labelAfterUndo.y + 3);
  await page.mouse.down();
  await page.mouse.move(labelAfterUndo.x + 60, labelAfterUndo.y + 23, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await select(0);
  check((await value('X')) === rootX, 'Escape отменяет незавершённое перемещение окна');
  await page.locator('#fit').click();
  await waitView();

  let before = await frame();
  const saveBeforePan = await page.locator('#save').isEnabled();
  const vp = await page.locator('#viewport').boundingBox();
  await page.locator('#viewport').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(vp.x + 30, vp.y + 45);
  await page.mouse.down();
  await page.mouse.move(vp.x + 100, vp.y + 90, { steps: 7 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  let after = await frame();
  check(
    Math.abs(after.x - before.x - 70) < 2 && Math.abs(after.y - before.y - 45) < 2,
    'Пробел с мышью перемещает холст',
  );
  check(
    (await page.locator('#save').isEnabled()) === saveBeforePan,
    'Перемещение холста не редактирует игру',
  );
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -35);
  await page.keyboard.up('Control');
  await page.waitForTimeout(80);
  check((await frame()).z > after.z, 'Ctrl с колёсиком приближает холст');
  await page.locator('#viewport').press('Shift+1');
  await waitView();
  await select(1);
  await page.locator('#viewport').press('Shift+2');
  await waitView();
  check((await frame()).z >= 2, 'Shift 2 приближает выделение');
  await page.locator('#viewport').press('Shift+1');
  await waitView();

  await page.locator('#reset').click();
  await select(0);
  await field('Ширина').fill('500');
  await field('Ширина').press('Tab');
  check(await page.locator('#save').isEnabled(), 'Изменения свойств включают сохранение');
  await page.locator('#client-open').click();
  await field('Путь к папке игры').fill(path.join(fixture, 'not-opened'));
  await page.locator('#client-dialog [data-close]').click();
  check(
    await page.locator('#save').isEnabled(),
    'Отмена выбора другой папки не блокирует сохранение текущей',
  );
  await page.keyboard.press('Control+s');
  await page.waitForFunction(
    () => document.getElementById('dirty').textContent === 'Нет изменений',
  );
  check(
    prop(
      walk(parse(decode(await fs.readFile(path.join(effects, file.name))))).find(
        (n) => n.kind === 'windowUI',
      ),
      'size',
    ).value === `500 ${baseHeight}`,
    'Ctrl S сохраняет только в выбранную копию',
  );
  await page.locator('#history').click();
  await page.getByRole('button', { name: 'Восстановить', exact: true }).first().click();
  await page.waitForFunction(() => !document.getElementById('backup-dialog').open);
  check(
    hash(await fs.readFile(path.join(effects, file.name))) === file.hash,
    'Откат из GUI восстанавливает исходные байты',
  );

  await popup('#scale-open', '#scale-popup');
  await page.locator('#scale').selectOption('1.25');
  await page.locator('#scale-window').click();
  await popup('#scale-open', '#scale-popup');
  await page.locator('#scale-window').click();
  await waitView();
  check(
    (await value('Ширина')) === Math.round(baseWidth * 1.25),
    'Повторное масштабирование UI не накапливается',
  );
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const profileFile = path.join(fixture, 'profile.json');
  await (await downloadPromise).saveAs(profileFile);
  const profile = JSON.parse(await fs.readFile(profileFile, 'utf8'));
  const originalRoot = walk(parse(decode(await fs.readFile(path.join(effects, file.name))))).find(
    (n) => n.kind === 'windowUI',
  );
  const uv = walk(originalRoot)
    .flatMap((n) => n.props)
    .find((p) => p.key === 'tcoords');
  check(
    profile.edits.some((e) => e.key === 'tcoords' && e.value === uv.value),
    'Профиль не масштабирует координаты текстур',
  );
  check(
    profile.edits.filter((e) => e.node.includes('root/0/0/0') && e.key === 'texture').length > 1,
    'Повторные фрагменты спрайтов сохраняются в профиле',
  );
  await page.locator('#reset').click();
  await page.locator('#profile').setInputFiles(profileFile);
  await page.waitForFunction(() =>
    document.getElementById('toast-text').textContent.startsWith('Профиль загружен:'),
  );
  check(
    (await value('Ширина')) === Math.round(baseWidth * 1.25),
    'Профиль возвращает оформление окна',
  );

  await page.locator('#reset').click();
  await waitView();
  await page.locator('#client-open').click();
  check(
    (await page.locator('.recent-client').count()) === 1,
    'В списке только выбранная тестовая копия, без заданных автором путей',
  );
  await page.route('**/api/pick-folder', (route) => route.fulfill({ json: { path: fixture } }));
  await page.locator('#browse-client').click();
  check(
    (await field('Путь к папке игры').inputValue()) === fixture,
    'Выбранная через диалог папка попадает в поле',
  );
  await page.locator('#discover-clients').click();
  await page.waitForFunction(() =>
    document.getElementById('discovery-status').textContent.startsWith('Найдено копий:'),
  );
  check(
    await page
      .locator('#discovery-status')
      .textContent()
      .then((t) => t.includes('Найдено копий: 1')),
    'Поиск находит клиент в указанном каталоге',
  );
  await page.locator('#connect-client').click();
  await page.waitForFunction(() => !document.getElementById('client-dialog').open);
  check(
    (await request('/api/client', { path: path.join(fixture, 'missing') })).status === 400,
    'Несуществующий путь отклоняется',
  );
  check(
    (await request('/api/catalog')).data.client === (await fs.realpath(fixture)),
    'Ошибка открытия не меняет текущую копию',
  );

  await popup('#view-open', '#view-popup');
  await page.locator('#screen-mode').check();
  await page.locator('#resolution').selectOption('3440 × 1440');
  await page.locator('#view-open').click();
  await waitView();
  await page.setViewportSize({ width: 1100, height: 800 });
  await waitView();
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Редактор помещается на ноутбуке без горизонтальной прокрутки',
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await popup('#view-open', '#view-popup');
  await page.locator('#screen-mode').uncheck();
  await page.locator('#view-open').click();
  await waitView();
  await page.screenshot({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-studio.png'),
  });
  check(errors.length === 0, 'Браузер работает без ошибок: ' + errors.join('; '));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(
    (await page.locator('.floating-tools').evaluate((n) => getComputedStyle(n).animationName)) ===
      'none',
    'Уменьшение движения отключает декоративные анимации',
  );
  await popup('#scale-open', '#scale-popup');
  await page.locator('#scale').selectOption('1.5');
  await page.locator('#scale-all').click();
  await page.locator('#save').click();
  await page.waitForFunction(
    () => document.getElementById('dirty').textContent === 'Нет изменений',
  );
  check(
    await page
      .locator('#toast-text')
      .textContent()
      .then((t) => t.startsWith('Сохранено файлов:')),
    'Общий масштаб сохраняется с резервной копией',
  );

  // A clean installation starts without any client, then remembers only the chosen folder.
  const freshSettings = path.join(fixture, 'fresh-editor-settings.json');
  let child;
  const startServer = async () => {
    child = spawn(process.execPath, ['server.mjs', '--port', '5191', '--settings', freshSettings], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', (code) => reject(Error('Server exited: ' + code)));
    });
  };
  try {
    await startServer();
    let catalog = await (await fetch('http://127.0.0.1:5191/api/catalog')).json();
    check(
      catalog.client === null && catalog.files.length === 0,
      'При первом запуске нет папки клиента по умолчанию',
    );
    const emptyPage = await browser.newPage();
    await emptyPage.goto('http://127.0.0.1:5191');
    await emptyPage.locator('#welcome-open').waitFor({ state: 'visible' });
    check(
      await emptyPage.locator('#empty-state').isVisible(),
      'Первый запуск предлагает выбрать папку игры',
    );
    check(
      (await (await fetch('http://127.0.0.1:5191/api/clients')).json()).length === 0,
      'Первый запуск не подставляет чужие адреса',
    );
    await emptyPage.close();
    await fetch('http://127.0.0.1:5191/api/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fixture }),
    });
    const config = JSON.parse(await fs.readFile(freshSettings, 'utf8'));
    check(
      config.lastClient === (await fs.realpath(fixture)) && config.recent.length === 1,
      'Настройки содержат выбранную пользователем папку',
    );
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
    });
    await startServer();
    catalog = await (await fetch('http://127.0.0.1:5191/api/catalog')).json();
    check(
      catalog.client === (await fs.realpath(fixture)),
      'После перезапуска открывается последняя выбранная копия',
    );
  } finally {
    child?.kill();
  }
  await page.close();
}
