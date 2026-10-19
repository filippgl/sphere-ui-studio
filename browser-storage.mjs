import { decode, encode, parse, walk, applyEdits } from './ui-core.mjs';
import { rgbaFromDds } from './dds-core.mjs';
import { entries, child, read, write, permission, UploadedDirectory } from './browser-files.mjs';
import { zip, download } from './zip.mjs';
import { resolution } from './layout-core.mjs';
import { fontDefinitions, prepareFonts, validAsset, backupFile, readSfn } from './font-core.mjs';
import { currentIconScale } from './icons-core.mjs';
import { backupId, historyEntries, restorePlan } from './history-core.mjs';
import {
  prepareGameAssets,
  configChatFonts,
  mapScriptScales,
  mapScriptName,
} from './game-core.mjs';

export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2));
const backupName = '_interface-editor-backups';
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sphere-ui-studio', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('roots', { keyPath: 'id' });
      db.createObjectStore('settings');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
function dbRequest(db, store, operation, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      store,
      operation === 'get' || operation === 'getAll' ? 'readonly' : 'readwrite',
    );
    const target = transaction.objectStore(store);
    const request =
      operation === 'getAll'
        ? target.getAll()
        : operation === 'put'
          ? target.put(value, key)
          : target.get(key);
    let result;
    request.onsuccess = () => (result = request.result);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error);
  });
}

export class BrowserStorage {
  mode = 'browser';
  records = new Map();
  current = null;
  names = new Set();
  fonts = [];
  restricted = new Set();
  strings = {};
  imageCache = new Map();
  busy = false;
  research = new URL('./WINDOWS.md', import.meta.url).href;
  static async open() {
    const result = new BrowserStorage();
    try {
      result.db = await openDatabase();
      for (const record of await dbRequest(result.db, 'roots', 'getAll'))
        result.records.set(record.id, record);
      const last = await dbRequest(result.db, 'settings', 'get', 'lastClient');
      if (result.records.has(last) && (await permission(result.records.get(last).handle)))
        await result.select(last, false);
    } catch {
      /* Folder selection still works when browser storage is unavailable. */
    }
    return result;
  }
  get downloadOnly() {
    return !!this.current?.downloadOnly;
  }
  async remember(record) {
    if (!this.db || record.downloadOnly) return;
    try {
      await dbRequest(this.db, 'roots', 'put', undefined, record);
      await dbRequest(this.db, 'settings', 'put', 'lastClient', record.id);
    } catch {
      /* Permission handles are optional; the current directory remains open. */
    }
  }
  async register(handle, downloadOnly = false) {
    for (const record of this.records.values()) {
      try {
        if (await record.handle.isSameEntry(handle)) return record;
      } catch {}
    }
    const record = {
      id: 'browser:' + crypto.randomUUID(),
      name: handle.name,
      handle,
      downloadOnly,
      opened: false,
    };
    this.records.set(record.id, record);
    return record;
  }
  async pickFolder() {
    if (!globalThis.showDirectoryPicker)
      throw Error(
        'Этот браузер поддерживает импорт папки и скачивание изменений. Для прямой записи откройте сайт в Chrome или Edge.',
      );
    try {
      const handle = await globalThis.showDirectoryPicker({
        id: 'sphere-client',
        mode: 'readwrite',
      });
      const record = await this.register(handle);
      return { path: record.id, name: record.name };
    } catch (error) {
      if (error.name === 'AbortError') return { path: null };
      throw error;
    }
  }
  async importFiles(files) {
    const handle = await UploadedDirectory.fromFiles(files),
      record = await this.register(handle, true);
    await this.select(record.id);
    return record.id;
  }
  async select(id, request = true) {
    const record = this.records.get(id);
    if (!record) throw Error('Сначала выберите папку через диалог браузера');
    if (!(await permission(record.handle, request)))
      throw Error('Разрешите доступ к папке, нажав на неё в списке или выбрав заново');
    if (this.busy) throw Error('Дождитесь завершения сохранения');
    this.busy = true;
    try {
      const rootEntries = await entries(record.handle);
      if (!rootEntries.some((e) => e.kind === 'file' && /^sphereclient.*\.exe$/i.test(e.name)))
        throw Error('В выбранной папке не найден sphereclient.exe');
      const effects = await child(record.handle, 'effects');
      const names = (await entries(effects))
        .filter((e) => e.kind === 'file' && /\.ui$/i.test(e.name))
        .map((e) => e.name);
      if (!names.length) throw Error('В папке effects нет файлов интерфейса');
      for (const name of names) parse(decode(await read(effects, name)));
      let strings = {},
        fonts = [
          { id: 0, name: 'Классический малый' },
          { id: 1, name: 'Классический крупный' },
        ];
      try {
        const language = await child(record.handle, 'language');
        for (const m of decode(await read(language, 'strings.ui')).matchAll(
          /^\s*string\s+(\w+)\s+"(.*?)"/gm,
        ))
          strings[m[1]] = m[2];
      } catch {}
      const restricted = new Set();
      try {
        for (const m of decode(await read(record.handle, 'fonts.cfg')).matchAll(
          /^\s*NEW_FONT_(\d+)\s+"([^"]+)"[^\r\n]*?(?:\/\/\s*([^\r\n]+))?$/gm,
        ))
          fonts.push({ id: Number(m[1]) + 2, asset: m[2], name: m[3]?.trim() || m[2] });
      } catch (error) {
        if (error.name === 'BrowserFileRestriction') restricted.add('fonts.cfg');
      }
      for (const font of fonts)
        if (font.asset) {
          try {
            font.height = readSfn(await read(effects, font.asset + '.sfn')).height;
          } catch {}
        }
      for (const url of this.imageCache.values()) URL.revokeObjectURL(await url.catch(() => ''));
      this.imageCache.clear();
      this.current = record;
      this.effects = effects;
      this.names = new Set(names);
      this.strings = strings;
      this.fonts = fonts;
      this.restricted = restricted;
      record.opened = true;
      await this.remember(record);
      return { client: id };
    } finally {
      this.busy = false;
    }
  }
  async getFile(name) {
    if (!this.names.has(name)) throw Error('Неизвестный файл интерфейса');
    const bytes = await read(this.effects, name);
    return { name, hash: await sha256(bytes), tree: parse(decode(bytes)) };
  }
  async catalog() {
    if (this.busy) throw Error('Дождитесь завершения операции');
    if (!this.current)
      return {
        client: null,
        files: [],
        strings: {},
        fonts: [],
        backups: [],
        storageMode: 'browser',
      };
    const current = this.current,
      files = await Promise.all([...this.names].map((name) => this.getFile(name)));
    if (current !== this.current) throw Error('Папка переключена. Перечитайте страницу');
    return {
      client: current.id,
      clientLabel: current.name,
      files,
      strings: this.strings,
      fonts: this.fonts,
      fontsHash: await this.digest(await this.viewRead({ scope: 'root', name: 'fonts.cfg' })),
      resolution: resolution(
        decode((await this.viewRead({ scope: 'root', name: 'config.cfg' })) || new Uint8Array()),
      ),
      chatFonts: configChatFonts(await this.viewRead({ scope: 'root', name: 'config.cfg' })),
      mapScales: await mapScriptScales(await this.viewRead({ scope: 'mbc', name: mapScriptName })),
      iconScale: await currentIconScale((scope, name) => this.viewRead({ scope, name })),
      restricted: [...this.restricted],
      backups: await this.backups(),
      storageMode: current.downloadOnly ? 'download' : 'browser',
    };
  }
  async backups() {
    if (!this.current) return [];
    try {
      const root = await child(this.current.handle, backupName),
        ids = [];
      for (const e of await entries(root))
        if (e.kind === 'directory' && /^\d{4}-/.test(e.name)) {
          try {
            await read(e, 'manifest.json');
            let state;
            try {
              state = JSON.parse(new TextDecoder().decode(await read(e, 'transaction.json'))).state;
            } catch {}
            if (!state || state === 'committed') ids.push(e.name);
          } catch {}
        }
      return ids.sort().reverse();
    } catch {
      return [];
    }
  }
  async exclusive(fn) {
    const current = this.current;
    if (!current) throw Error('Сначала выберите папку клиента');
    if (!(await permission(current.handle, true)))
      throw Error('Нет разрешения на запись в выбранную папку');
    if (current !== this.current) throw Error('Выбрана другая папка. Повторите операцию');
    if (this.busy) throw Error('Дождитесь предыдущей операции');
    this.busy = true;
    try {
      return navigator.locks
        ? await navigator.locks.request('sphere-studio-files', fn)
        : await fn();
    } finally {
      this.busy = false;
    }
  }
  async assetDir(item, create = false) {
    return item.scope === 'root'
      ? this.current.handle
      : item.scope
        ? child(this.current.handle, item.scope, 'directory', create)
        : this.effects;
  }
  async optionalRead(item) {
    try {
      return await read(await this.assetDir(item), item.name);
    } catch (error) {
      if (error.name === 'NotFoundError') return null;
      throw error;
    }
  }
  // Chromium refuses some names (*.cfg on Windows); the windows still open without them.
  async viewRead(item) {
    try {
      return await this.optionalRead(item);
    } catch (error) {
      if (error.name !== 'BrowserFileRestriction') throw error;
      this.restricted.add(item.name);
      return null;
    }
  }
  async digest(bytes) {
    return bytes === null ? null : sha256(bytes);
  }
  async putAsset(item, bytes) {
    const dir = await this.assetDir(item, bytes !== null);
    if (bytes === null) {
      try {
        await dir.removeEntry(item.name);
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    } else await write(dir, item.name, bytes);
  }
  async refreshFonts() {
    this.fonts = [
      { id: 0, name: 'Классический малый' },
      { id: 1, name: 'Классический крупный' },
      ...fontDefinitions(
        decode((await this.viewRead({ scope: 'root', name: 'fonts.cfg' })) || new Uint8Array()),
      ),
    ];
    for (const font of this.fonts)
      if (font.asset) {
        try {
          font.height = readSfn(await read(this.effects, font.asset + '.sfn')).height;
        } catch {}
      }
  }
  async save(files, fontScales = [], fontsHash, game = {}) {
    const current = this.current;
    const result = await this.exclusive(async () => {
      if (current !== this.current) throw Error('Выбрана другая папка');
      if (!Array.isArray(files) || new Set(files.map((f) => f.name)).size !== files.length)
        throw Error('Нет изменений или файлы повторяются');
      const changes = [];
      const cfg = fontScales.length
        ? await this.optionalRead({ scope: 'root', name: 'fonts.cfg' })
        : null;
      if (fontScales.length && (await this.digest(cfg)) !== fontsHash)
        throw Error('fonts.cfg изменился. Перечитайте папку');
      const generated = fontScales.length
        ? await prepareFonts(
            fontScales,
            cfg,
            async (scope, name) => read(await child(current.handle, scope), name),
            async (scope) =>
              (await entries(await child(current.handle, scope)))
                .filter((e) => e.kind === 'file')
                .map((e) => e.name),
          )
        : { assets: [], definitions: this.fonts };
      for (const f of files) {
        if (!this.names.has(f.name)) throw Error('Неизвестный файл');
        const before = await read(this.effects, f.name);
        if ((await sha256(before)) !== f.hash)
          throw Error(
            `${f.name}: файл изменился на диске. Откройте папку заново перед сохранением`,
          );
        const fontFields = walk(parse(decode(before)))
          .flatMap((n) => n.props)
          .filter((p) => p.key.toLowerCase() === 'font');
        if (!Array.isArray(f.edits)) throw Error('Нет полей для изменения');
        for (const edit of f.edits)
          if (
            fontFields.some((p) => p.start === edit.start) &&
            !generated.definitions.some((f) => f.id === Number(edit.value))
          )
            throw Error('Этот шрифт не указан в fonts.cfg');
        const after = encode(applyEdits(decode(before), f.edits));
        changes.push({
          name: f.name,
          before,
          after,
          beforeHash: await sha256(before),
          afterHash: await sha256(after),
        });
      }
      const extra = await prepareGameAssets(
        game,
        (scope, name) => this.optionalRead({ scope, name }),
        generated.definitions,
        {
          list: async (scope) => {
            try {
              return (await entries(await child(current.handle, scope)))
                .filter((e) => e.kind === 'file')
                .map((e) => e.name);
            } catch {
              return [];
            }
          },
          uiTexts: game?.iconScale
            ? await Promise.all(
                [...this.names].map(async (n) => decode(await read(this.effects, n))),
              )
            : [],
        },
      );
      for (const asset of [...generated.assets, ...extra.assets]) {
        const before = await this.optionalRead(asset),
          beforeHash = await this.digest(before),
          afterHash = await this.digest(asset.after);
        if (
          ['effects', 'xadd'].includes(asset.scope) &&
          before !== null &&
          beforeHash !== afterHash
        )
          throw Error(`Файл ${asset.name} уже существует с другим содержимым`);
        changes.push({ ...asset, before, beforeHash, afterHash });
      }
      if (!changes.length) throw Error('Нет изменений');
      changes.sort((a, b) => Number(!a.scope) - Number(!b.scope));
      const id = backupId(await this.backups(), crypto.randomUUID());
      const backupRoot = await child(current.handle, backupName, 'directory', true),
        dir = await child(backupRoot, id, 'directory', true);
      for (const c of changes) if (c.before !== null) await write(dir, backupFile(c), c.before);
      await write(
        dir,
        'manifest.json',
        jsonBytes(
          changes.map((c) => ({
            name: c.name,
            ...(c.scope ? { scope: c.scope } : {}),
            before: c.beforeHash,
            after: c.afterHash,
          })),
        ),
      );
      await write(dir, 'transaction.json', jsonBytes({ state: 'pending' }));
      const written = [];
      try {
        for (const c of changes) {
          if ((await this.digest(await this.optionalRead(c))) !== c.beforeHash)
            throw Error(`${c.name}: файл изменился во время сохранения`);
          await this.putAsset(c, c.after);
          written.push(c);
        }
        await write(dir, 'transaction.json', jsonBytes({ state: 'committed' }));
      } catch (error) {
        let recovered = true;
        for (const c of written.reverse()) {
          try {
            if ((await this.digest(await this.optionalRead(c))) === c.afterHash)
              await this.putAsset(c, c.before);
            else recovered = false;
          } catch {
            recovered = false;
          }
        }
        try {
          await write(
            dir,
            'transaction.json',
            jsonBytes({ state: recovered ? 'rolled-back' : 'failed', error: error.message }),
          );
        } catch {}
        throw Error(
          error.message +
            (recovered
              ? ''
              : `. Исходные файлы сохранены в ${backupName}/${id}; восстановите их из резервной копии.`),
        );
      }
      await this.refreshFonts();
      return {
        backup: id,
        files: await Promise.all(changes.filter((c) => !c.scope).map((c) => this.getFile(c.name))),
        fonts: this.fonts,
        fontsHash: await this.digest(await this.viewRead({ scope: 'root', name: 'fonts.cfg' })),
        chatFonts: configChatFonts(await this.viewRead({ scope: 'root', name: 'config.cfg' })),
        mapScales: await mapScriptScales(
          await this.viewRead({ scope: 'mbc', name: mapScriptName }),
        ),
        iconScale: await currentIconScale((scope, name) => this.viewRead({ scope, name })),
        warnings: extra.warnings,
        downloadOnly: current.downloadOnly,
      };
    });
    if (current.downloadOnly)
      await this.exportChanges(
        result.files.map((f) => f.name),
        result.backup,
      );
    return result;
  }
  async restore(id) {
    if (!(await this.backups()).includes(id)) throw Error('Резервная копия не найдена');
    const result = await this.exclusive(async () => {
      const ids = await this.backups(),
        root = await child(this.current.handle, backupName);
      const plan = await restorePlan(
        id,
        ids,
        async (revision) =>
          JSON.parse(
            new TextDecoder().decode(await read(await child(root, revision), 'manifest.json')),
          ),
        async (revision, item) => read(await child(root, revision), backupFile(item)),
        (bytes) => this.digest(bytes),
        (item) => (item.scope ? validAsset(item) : this.names.has(item.name)),
      );
      const files = await Promise.all(
        plan.files.map(async (item) => ({ ...item, current: await this.optionalRead(item) })),
      );
      const checkpoint = backupId(ids, crypto.randomUUID()),
        dir = await child(root, checkpoint, 'directory', true);
      for (const item of files)
        if (item.current !== null) await write(dir, backupFile(item), item.current);
      await write(
        dir,
        'manifest.json',
        jsonBytes(
          await Promise.all(
            files.map(async (item) => ({
              name: item.name,
              ...(item.scope ? { scope: item.scope } : {}),
              before: await this.digest(item.current),
              after: await this.digest(item.bytes),
            })),
          ),
        ),
      );
      const transaction = {
        state: 'pending',
        kind: 'restore',
        target: id,
        revisions: plan.revisions,
      };
      await write(dir, 'transaction.json', jsonBytes(transaction));
      const written = [];
      try {
        for (const f of files) {
          if ((await this.digest(await this.optionalRead(f))) !== (await this.digest(f.current)))
            throw Error(`${f.name}: файл изменился во время отката`);
          await this.putAsset(f, f.bytes);
          written.push(f);
        }
        await write(dir, 'transaction.json', jsonBytes({ ...transaction, state: 'committed' }));
      } catch (error) {
        for (const f of written.reverse())
          try {
            if ((await this.digest(await this.optionalRead(f))) === (await this.digest(f.bytes)))
              await this.putAsset(f, f.current);
          } catch {}
        await write(dir, 'transaction.json', jsonBytes({ ...transaction, state: 'rolled-back' }));
        throw error;
      }
      await this.refreshFonts();
      return {
        restored: files.map((f) => f.name),
        backup: checkpoint,
        revisions: plan.revisions,
        downloadOnly: this.downloadOnly,
      };
    });
    if (result.downloadOnly) await this.exportChanges(result.restored, result.backup);
    return result;
  }
  async exportChanges(names, backup) {
    const root = await child(this.current.handle, backupName),
      dir = await child(root, backup),
      files = [];
    const manifest = JSON.parse(new TextDecoder().decode(await read(dir, 'manifest.json')));
    for (const item of manifest) {
      const bytes = await this.optionalRead(item);
      if (bytes !== null)
        files.push({
          path: (item.scope === 'root' ? '' : (item.scope || 'effects') + '/') + item.name,
          bytes,
        });
      if (item.before !== null)
        files.push({
          path: `${backupName}/${backup}/${backupFile(item)}`,
          bytes: await read(dir, backupFile(item)),
        });
    }
    files.push({
      path: `${backupName}/${backup}/manifest.json`,
      bytes: await read(dir, 'manifest.json'),
    });
    files.push({
      path: 'Sphere Studio - прочитайте.txt',
      bytes:
        'Распакуйте этот архив в папку выбранного клиента с заменой файлов effects. Перед заменой сохраните копию текущих файлов. Папка _interface-editor-backups содержит исходные файлы до правки. Браузер работает в режиме архива: файлы на диске ещё не изменены.\r\n',
    });
    download(zip(files), `sphere-ui-${backup}.zip`);
  }
  async texture(name) {
    if (!this.current || !/^[\w-]+$/i.test(name)) throw Error('Неизвестная текстура');
    const key = name.toLowerCase();
    if (this.imageCache.has(key)) return this.imageCache.get(key);
    const root = this.current.handle;
    const task = (async () => {
      for (const parts of [['textures', 'fx'], ['xadd'], ['textures']]) {
        try {
          let dir = root;
          for (const part of parts) dir = await child(dir, part);
          const bytes = await read(dir, name + '.dds'),
            image = rgbaFromDds(bytes);
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          context.putImageData(
            new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
            0,
            0,
          );
          const blob = await new Promise((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(Error('Не удалось прочитать текстуру'))),
              'image/png',
            ),
          );
          return URL.createObjectURL(blob);
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error;
        }
      }
      throw Error('Текстура отсутствует');
    })();
    this.imageCache.set(key, task);
    return task;
  }
  async discover(id) {
    const record = this.records.get(id);
    if (!record) throw Error('Сначала выберите каталог через кнопку выбора папки');
    const queue = [[record.handle, 0]],
      paths = [];
    let visited = 0;
    while (queue.length && visited < 2000) {
      const [dir, depth] = queue.shift();
      visited++;
      let all;
      try {
        all = await entries(dir);
      } catch {
        continue;
      }
      if (
        all.some((e) => e.kind === 'file' && /^sphereclient.*\.exe$/i.test(e.name)) &&
        all.some((e) => e.kind === 'directory' && e.name.toLowerCase() === 'effects')
      ) {
        const client = await this.register(dir, record.downloadOnly);
        client.discovered = true;
        paths.push({ id: client.id, name: client.name, display: client.name });
      }
      if (depth < 3)
        for (const e of all)
          if (e.kind === 'directory' && !e.name.startsWith('.') && !e.name.startsWith('$'))
            queue.push([e, depth + 1]);
    }
    return { paths, visited, limited: queue.length > 0 };
  }
  async call(url, body = {}) {
    if (body.client && body.client !== this.current?.id)
      throw Error('Выбрана другая папка игры. Откройте её заново');
    switch (url) {
      case '/api/catalog':
        return this.catalog();
      case '/api/clients':
        return [...this.records.values()]
          .filter((r) => r.opened || r.discovered)
          .map((r) => ({ id: r.id, name: r.name, display: r.name }));
      case '/api/client':
        return this.select(body.path);
      case '/api/pick-folder':
        return this.pickFolder();
      case '/api/discover':
        return this.discover(body.path);
      case '/api/backups':
        return this.backups();
      case '/api/history': {
        const root =
          this.current && (await child(this.current.handle, backupName).catch(() => null));
        if (!root) return [];
        return historyEntries(
          await this.backups(),
          async (id) => {
            const dir = await child(root, id);
            let transaction;
            try {
              transaction = JSON.parse(
                new TextDecoder().decode(await read(dir, 'transaction.json')),
              );
            } catch {}
            return {
              manifest: JSON.parse(new TextDecoder().decode(await read(dir, 'manifest.json'))),
              transaction,
            };
          },
          (item) => (item.scope ? validAsset(item) : this.names.has(item.name)),
        );
      }
      case '/api/save':
        return this.save(body.files, body.fontScales, body.fontsHash, body.game);
      case '/api/restore':
        return this.restore(body.id);
      default:
        throw Error('Неизвестная команда');
    }
  }
}
