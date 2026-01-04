import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function requireAdmin(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  return cookie.includes("admin=1");
}

export async function GET(req: Request) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("exam_attempts")
    .select("id, emp_id, started_at, submitted_at, score")
    .order("id", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: data || [] });
}
