export async function entries(handle) {
  const result = [];
  for await (const value of handle.values()) result.push(value);
  return result;
}
export async function child(handle, name, kind = 'directory', create = false) {
  const method = kind === 'directory' ? 'getDirectoryHandle' : 'getFileHandle';
  try {
    return await handle[method](name, { create: false });
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
    const match = (await entries(handle)).find(
      (e) => e.name.toLowerCase() === name.toLowerCase() && e.kind === kind,
    );
    if (match) return match;
    if (create) return handle[method](name, { create: true });
    throw error;
  }
}
export async function read(handle, name) {
  const file = await (await child(handle, name, 'file')).getFile();
  return new Uint8Array(await file.arrayBuffer());
}
export async function write(handle, name, bytes) {
  const file = await child(handle, name, 'file', true),
    stream = await file.createWritable();
  try {
    await stream.write(bytes);
    await stream.close();
  } catch (error) {
    try {
      await stream.abort();
    } catch {}
    throw error;
  }
}
export async function permission(handle, request = false) {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return request && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export class UploadedDirectory {
  constructor(name) {
    this.name = name;
    this.kind = 'directory';
    this.children = new Map();
  }
  async *values() {
    yield* this.children.values();
  }
  async removeEntry(name) {
    if (!this.children.delete(name)) throw new DOMException('Файл не найден', 'NotFoundError');
  }
  async getDirectoryHandle(name, options = {}) {
    const value = this.children.get(name);
    if (value?.kind === 'directory') return value;
    if (!value && options.create) {
      const next = new UploadedDirectory(name);
      this.children.set(name, next);
      return next;
    }
    throw new DOMException('Папка не найдена', 'NotFoundError');
  }
  async getFileHandle(name, options = {}) {
    const value = this.children.get(name);
    if (value?.kind === 'file') return value;
    if (!value && options.create) {
      const next = {
        kind: 'file',
        name,
        file: new File([], name),
        async getFile() {
          return this.file;
        },
        async createWritable() {
          const owner = this;
          let bytes;
          return {
            async write(value) {
              bytes = value;
            },
            async close() {
              owner.file = new File([bytes], name);
            },
            async abort() {},
          };
        },
      };
      this.children.set(name, next);
      return next;
    }
    throw new DOMException('Файл не найден', 'NotFoundError');
  }
  async queryPermission() {
    return 'granted';
  }
  async isSameEntry(other) {
    return other === this;
  }
  static async fromFiles(files) {
    const first = files[0]?.webkitRelativePath.split('/')[0];
    if (!first) throw Error('Выберите папку клиента целиком');
    const root = new UploadedDirectory(first);
    for (const file of files) {
      const parts = file.webkitRelativePath.split('/');
      if (parts.shift() !== first || parts.some((p) => !p || p === '.' || p === '..'))
        throw Error('Неподходящий путь файла');
      let dir = root;
      for (const part of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts.at(-1), { create: true });
      handle.file = file;
    }
    return root;
  }
}
