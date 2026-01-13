import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * 한글 CSV (EUC-KR / UTF-8) + 헤더:
 * 문항ID,문제유형,문제내용,보기1,보기2,보기3,보기4,정답,배점
 */

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

/** CSV 파서 */
function parseCSV(text: string) {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (!inQ && ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }

    if (!inQ && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => s(c) !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  row.push(cur);
  if (row.some((c) => s(c) !== "")) rows.push(row);
  return rows;
}

/** 인코딩 자동 판별 */
function decodeSmart(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  let t = new TextDecoder("utf-8", { fatal: false }).decode(u8);

  if (t.includes("�") || !/[가-힣]/.test(t.slice(0, 200))) {
    try {
      t = new TextDecoder("euc-kr", { fatal: false }).decode(u8);
    } catch {}
  }
  return t;
}

function norm(h: string) {
  return s(h).replace(/\uFEFF/g, "").replace(/\s+/g, "").toLowerCase();
}

function parseAnswer(v: string) {
  const n = Number(s(v));
  if (Number.isFinite(n)) {
    const x = Math.trunc(n);
    if (x >= 1 && x <= 4) return x - 1;
    if (x >= 0 && x <= 3) return x;
  }
  return -1;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "NO_FILE" }, { status: 400 });
    }

    const text = decodeSmart(await file.arrayBuffer());
    const rows = parseCSV(text);

    if (rows.length < 2) {
      return NextResponse.json({ ok: false, error: "NO_ROWS" }, { status: 400 });
    }

    const header = rows[0].map(norm);
    const body = rows.slice(1);
    const payload: any[] = [];

    for (const cols of body) {
      const o: Record<string, string> = {};
      header.forEach((h, i) => (o[h] = cols[i] ?? ""));

      const content = s(o["문제내용"]);
      const choices = [s(o["보기1"]), s(o["보기2"]), s(o["보기3"]), s(o["보기4"])];
      const answer = parseAnswer(o["정답"]);
      const points = Number(o["배점"]) || 1;

      if (!content || answer < 0 || !choices.some(Boolean)) continue;

      payload.push({
        content,
        choices,
        answer_index: answer,
        points,
        is_active: true,
      });
    }

    if (payload.length === 0) {
      return NextResponse.json({ ok: false, error: "NO_VALID_ROWS" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("questions").insert(payload);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, inserted: payload.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UPLOAD_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
