import runtime from './runtime.mjs';

export async function createStorage() {
  if (runtime.mode === 'browser') {
    const { BrowserStorage } = await import('./browser-storage.mjs');
    return BrowserStorage.open();
  }
  return {
    mode: 'local',
    async call(url, body) {
      const response = await fetch(
        new URL('.' + url, import.meta.url),
        body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {},
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      return result;
    },
    async texture(name) {
      const url = new URL('./api/texture', import.meta.url);
      url.searchParams.set('name', name);
      return url.href;
    },
    research: new URL('./api/research', import.meta.url).href,
  };
}
