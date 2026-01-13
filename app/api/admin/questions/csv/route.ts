import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TABLE = "questions";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function toNum(v: any, d: number) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : d;
}

function normalizeRow(r: any) {
  const content = s(r.content ?? r["문제내용"]);
  const choices = Array.isArray(r.choices)
    ? r.choices.map(s)
    : [s(r["보기1"]), s(r["보기2"]), s(r["보기3"]), s(r["보기4"])];

  const ans = toNum(r.answer_index ?? r["정답"], NaN);
  const answer_index = Number.isFinite(ans) ? Math.trunc(ans >= 1 ? ans - 1 : ans) : NaN;
  const points = Math.trunc(toNum(r.points ?? r["배점"], 1));

  if (!content || !choices.some(Boolean)) return null;
  if (!Number.isFinite(answer_index) || answer_index < 0 || answer_index > 3) return null;

  return { content, choices, answer_index, points, is_active: true };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rows = body?.rows ?? [];

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "NO_ROWS" }, { status: 400 });
    }

    const payload = rows.map(normalizeRow).filter(Boolean);

    if (payload.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_VALID_ROWS" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(TABLE).insert(payload);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "CSV_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, inserted: payload.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CSV_API_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
