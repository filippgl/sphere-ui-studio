import runtime from './runtime.mjs';

export async function createStorage() {
  if (runtime.mode === 'browser') {
    const { BrowserStorage } = await import('./browser-storage.mjs');
    const browser = await BrowserStorage.open();
    let active = browser;
    const result = {
      web: true,
      get mode() {
        return active.mode;
      },
      get research() {
        return active.research;
      },
      call: (...args) => active.call(...args),
      texture: (...args) => active.texture(...args),
      async importFiles(files) {
        await browser.importFiles(files);
        active = browser;
        try {
          localStorage.removeItem('sphere-companion');
        } catch {}
      },
      async connectCompanion(address) {
        const url = new URL(address);
        if (
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          url.protocol !== 'http:' ||
          url.username ||
          url.password
        )
          throw Error('Укажите локальный адрес помощника на своём компьютере');
        const remote = localStorageAdapter(new URL('/', url), 'bridge');
        await remote.call('/api/catalog');
        active = remote;
        try {
          localStorage.setItem('sphere-companion', url.origin);
        } catch {}
      },
    };
    try {
      const saved = localStorage.getItem('sphere-companion');
      if (saved) await result.connectCompanion(saved);
    } catch {}
    return result;
  }
  return localStorageAdapter(new URL('./', import.meta.url), 'local');
}
function localStorageAdapter(base, mode) {
  return {
    mode,
    async call(url, body) {
      const response = await fetch(
        new URL('.' + url, base),
        body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(120000),
            }
          : { signal: AbortSignal.timeout(mode === 'bridge' ? 5000 : 120000) },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      return result;
    },
    async texture(name) {
      const url = new URL('./api/texture', base);
      url.searchParams.set('name', name);
      return url.href;
    },
    research: new URL('./api/research', base).href,
  };
}
