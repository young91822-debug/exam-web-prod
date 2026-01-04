import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    url_len: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").length,
    url_json: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL)
      : null,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING",
  });
}
