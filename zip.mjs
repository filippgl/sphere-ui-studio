const utf8 = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ table[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

export function zip(entries) {
  const local = [],
    central = [];
  let offset = 0,
    centralLength = 0;
  for (const { path, bytes: raw } of entries) {
    if (
      !path ||
      path.startsWith('/') ||
      path.split('/').some((p) => !p || p === '..' || p === '.') ||
      path.includes('\\')
    )
      throw Error('Некорректный путь в архиве');
    const name = utf8.encode(path),
      bytes = raw instanceof Uint8Array ? raw : utf8.encode(raw);
    if (name.length > 65535 || bytes.length > 0xffffffff)
      throw Error('Файл слишком большой для ZIP');
    const checksum = crc32(bytes),
      header = new Uint8Array(30 + name.length),
      h = new DataView(header.buffer);
    const now = new Date(),
      year = Math.max(1980, Math.min(2107, now.getFullYear()));
    const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const dosTime =
      (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, checksum, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    local.push(header, bytes);
    const record = new Uint8Array(46 + name.length),
      r = new DataView(record.buffer);
    r.setUint32(0, 0x02014b50, true);
    r.setUint16(4, 20, true);
    r.setUint16(6, 20, true);
    r.setUint16(8, 0x0800, true);
    r.setUint16(12, dosTime, true);
    r.setUint16(14, dosDate, true);
    r.setUint32(16, checksum, true);
    r.setUint32(20, bytes.length, true);
    r.setUint32(24, bytes.length, true);
    r.setUint16(28, name.length, true);
    r.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);
    centralLength += record.length;
    offset += header.length + bytes.length;
  }
  if (entries.length > 65535 || offset + centralLength > 0xffffffff)
    throw Error('Архив слишком большой');
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralLength, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
