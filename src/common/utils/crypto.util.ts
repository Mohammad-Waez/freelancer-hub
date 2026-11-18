import { createHash } from 'node:crypto';

export function sha256(value: string, encoding: 'hex' | 'base64' = 'hex') {
  return createHash('sha256').update(value).digest(encoding);
}