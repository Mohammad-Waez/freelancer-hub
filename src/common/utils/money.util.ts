import type { Prisma } from '../../generated/prisma/client.js';

/** Money is always returned to the client as a string with 2 decimals. */
export const money = (value: Prisma.Decimal): string => value.toFixed(2);