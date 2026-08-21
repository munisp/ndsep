/**
 * NDSEP Cursor-Based Pagination
 * ===============================
 * Replaces OFFSET/LIMIT with keyset pagination for O(1) performance
 * on large datasets (500K+ data controllers).
 *
 * Recommendation M3: Cursor-based pagination for large datasets
 */

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
  totalEstimate?: number;
}

export interface CursorParams {
  cursor?: string;        // opaque cursor (base64-encoded id)
  limit?: number;         // items per page (default 50, max 200)
  direction?: "forward" | "backward";
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** Decode a cursor to get the underlying ID */
export function decodeCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const id = parseInt(decoded, 10);
    if (isNaN(id) || id <= 0) throw new Error("Invalid cursor");
    return id;
  } catch {
    throw new Error("Invalid cursor format");
  }
}

/** Encode an ID as an opaque cursor */
export function encodeCursor(id: number): string {
  return Buffer.from(String(id)).toString("base64url");
}

/**
 * Build a cursor-based SQL query.
 * Returns { whereClause, orderClause, limitClause, params }
 */
export function buildCursorQuery(
  params: CursorParams,
  idColumn: string = "id"
): {
  whereClause: string;
  orderClause: string;
  limitClause: string;
  cursorParam: number | null;
  limit: number;
} {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const direction = params.direction ?? "forward";
  const sortOrder = params.sortOrder ?? "desc";
  
  const isForward = direction === "forward";
  const operator = (isForward && sortOrder === "desc") || (!isForward && sortOrder === "asc") ? "<" : ">";

  let cursorParam: number | null = null;
  let whereClause = "";

  if (params.cursor) {
    cursorParam = decodeCursor(params.cursor);
    whereClause = `${idColumn} ${operator} ${cursorParam}`;
  }

  const orderClause = `${idColumn} ${sortOrder}`;
  const limitClause = `${limit + 1}`; // fetch one extra to detect hasMore

  return { whereClause, orderClause, limitClause, cursorParam, limit };
}

/**
 * Process query results into a CursorPage.
 * Expects results fetched with limit+1 to detect hasMore.
 */
export function buildCursorPage<T extends { id: number }>(
  results: T[],
  limit: number,
  direction: "forward" | "backward" = "forward"
): CursorPage<T> {
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1].id) : null,
    previousCursor: items.length > 0 ? encodeCursor(items[0].id) : null,
    hasMore,
  };
}
