import { createHash } from 'node:crypto';
import { encode as encodeBytes } from './ui-core.mjs';
export { decode, parse, walk, prop, value, unquote, editable, applyEdits } from './ui-core.mjs';
export const encode = (text) => Buffer.from(encodeBytes(text));
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
