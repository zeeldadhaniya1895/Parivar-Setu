// Server-only Supabase client. The service role key never reaches the browser: it has no
// NEXT_PUBLIC_ prefix, and every read and write goes through server components or route handlers.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("lib/db is server-only and must never run in the browser");
  }
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const PAGE_SIZE = 1000;

/** Read every row of a table, paging past Supabase's per-request row limit. */
export async function fetchAll<Row>(table: string, orderBy: string, columns = "*"): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db()
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(from, from + PAGE_SIZE - 1)
      .returns<Row[]>();
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
