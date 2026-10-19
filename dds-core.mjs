export function rgbaFromDds(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 128) throw Error('Текстура обрезана');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const u16 = (offset) => view.getUint16(offset, true);
  const uN = (offset, count) => {
    let n = 0;
    for (let i = 0; i < count; i++) n += buf[offset + i] * 2 ** (i * 8);
    return n;
  };
  const ascii = (start, end) => String.fromCharCode(...buf.subarray(start, end));
  if (ascii(0, 4) !== 'DDS ') throw Error('Неизвестный формат текстуры');
  const height = u32(12),
    width = u32(16);
  if (!width || !height || width * height > 16_777_216) throw Error('Недопустимый размер текстуры');
  const out = new Uint8Array(width * height * 4);
  const format = ascii(84, 88);
  const rgb565 = (n) => [
    Math.round((((n >> 11) & 31) * 255) / 31),
    Math.round((((n >> 5) & 63) * 255) / 63),
    Math.round(((n & 31) * 255) / 31),
    255,
  ];
  if (['DXT1', 'DXT3', 'DXT5'].includes(format)) {
    const blockSize = format === 'DXT1' ? 8 : 16;
    let p = 128;
    for (let by = 0; by < height; by += 4)
      for (let bx = 0; bx < width; bx += 4) {
        if (p + blockSize > buf.length) throw Error('Текстура обрезана');
        const rgb = p + (format === 'DXT1' ? 0 : 8);
        const c0 = u16(rgb),
          c1 = u16(rgb + 2);
        const a = rgb565(c0),
          b = rgb565(c1);
        const palette = [a, b];
        if (c0 > c1 || format !== 'DXT1') {
          palette.push(a.map((x, i) => (i === 3 ? 255 : Math.round((2 * x + b[i]) / 3))));
          palette.push(a.map((x, i) => (i === 3 ? 255 : Math.round((x + 2 * b[i]) / 3))));
        } else {
          palette.push(
            a.map((x, i) => (i === 3 ? 255 : Math.round((x + b[i]) / 2))),
            [0, 0, 0, 0],
          );
        }
        const indices = u32(rgb + 4);
        let alpha = null,
          alphaBits = 0n;
        if (format === 'DXT5') {
          alpha = [buf[p], buf[p + 1]];
          if (alpha[0] > alpha[1])
            for (let i = 1; i <= 6; i++)
              alpha.push(Math.round(((7 - i) * alpha[0] + i * alpha[1]) / 7));
          else {
            for (let i = 1; i <= 4; i++)
              alpha.push(Math.round(((5 - i) * alpha[0] + i * alpha[1]) / 5));
            alpha.push(0, 255);
          }
          for (let i = 0; i < 6; i++) alphaBits |= BigInt(buf[p + 2 + i]) << BigInt(i * 8);
        }
        for (let i = 0; i < 16; i++) {
          const x = bx + (i % 4),
            y = by + Math.floor(i / 4);
          if (x >= width || y >= height) continue;
          const color = [...palette[(indices >>> (i * 2)) & 3]];
          if (format === 'DXT3')
            color[3] = ((buf[p + Math.floor(i / 2)] >> ((i % 2) * 4)) & 15) * 17;
          if (alpha) color[3] = alpha[Number((alphaBits >> BigInt(i * 3)) & 7n)];
          out.set(color, (y * width + x) * 4);
        }
        p += blockSize;
      }
  } else {
    const bits = u32(88),
      stride = bits / 8;
    if (bits !== 32 && bits !== 24) throw Error(`Неподдерживаемая текстура: ${format}`);
    const masks = [92, 96, 100, 104].map((p) => u32(p));
    const rowPitch = Math.max(width * stride, u32(20) || 0);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const pos = 128 + y * rowPitch + x * stride;
        const pixel = bits === 32 ? u32(pos) : uN(pos, 3);
        masks.forEach((mask, i) => {
          let shift = 0,
            m = mask;
          if (m) {
            while (!(m & 1)) {
              m >>>= 1;
              shift++;
            }
          }
          out[(y * width + x) * 4 + i] = mask
            ? Math.round((((pixel & mask) >>> shift) * 255) / m)
            : i === 3
              ? 255
              : 0;
        });
      }
  }
  return { width, height, data: out };
}
