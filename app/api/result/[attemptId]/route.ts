// app/api/result/[attemptId]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function s(v: any) {
  return String(v ?? "").trim();
}

function pickCorrectIndex(q: any): number | null {
  const cands = [
    q?.correct_index,
    q?.correctIndex,
    q?.answer_index,
    q?.answerIndex,
    q?.correct_answer,
    q?.correctAnswer,
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function pickChoices(q: any): string[] {
  const c = q?.choices ?? q?.options ?? q?.choice_list ?? q?.choiceList ?? [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? ""));
    } catch {}
    if (c.includes("|")) return c.split("|").map((x) => x.trim());
    if (c.includes(",")) return c.split(",").map((x) => x.trim());
    return [c];
  }
  return [];
}

// ✅ Next 16.1.1(Turbopack)에서 context.params는 Promise로 옴
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  const { attemptId: raw } = await context.params;
  const attemptId = n(raw, null);

  if (!attemptId) {
    return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
  }

  const { data: attempt, error: aErr } =
