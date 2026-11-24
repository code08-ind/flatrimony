import { Me } from '@flatrimony/shared';

/**
 * Accepts a profile even when it holds values this app version does not know yet (a new category
 * or habit added on the server): a strict parse would lock older apps out on every launch. Routing
 * only needs the shape (preferences, areas/anchor, lifestyle); unknown values simply show as
 * unselected.
 */
export function readMe(body: unknown): Me | null {
  const strict = Me.safeParse(body);
  if (strict.success) return strict.data;
  const b = body as Partial<Me> | null;
  return b && typeof b === 'object' && typeof b.id === 'string' && typeof b.displayName === 'string'
    ? (b as Me)
    : null;
}
