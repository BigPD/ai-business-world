import { createClient } from "@supabase/supabase-js";

// Server-side only: uses the service role key, must never be exposed to the browser.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
