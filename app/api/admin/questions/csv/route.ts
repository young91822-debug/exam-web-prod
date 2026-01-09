// app/api/admin/questions/csv/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TABLE = "questions"; // 필요하면 "exam_questions" 등으로 변경

type IncomingRow = {
  [k: string]: any;
};

function s(v: any) {
  return String(v ?? "").trim();
}

function toNum(v: any, d: number) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : d;
}

/**
 * ✅ "문제은행.csv" 기준(한글 키)도 받고,
 * ✅ 프론트가 이미 변환한 영문 키(content/choices/answer_index/points)도 받게
 */
function normalizeRow(r: IncomingRow) {
  // 1) 영문 스키마로 이미 온 경우 (프론트에서 변환해서 보냄)
  const content1 = s(r.content ?? r.question ?? r.text);
  const choices1 = Array.isArray(r.choices) ? r.choices.map(s) : null;
  const ans1 = toNum(r.answer_index ?? r.correct_index ?? r.answer, NaN);
  const pts1 = toNum(r.points ?? r.point ?? r.score, 1);

  if (content1 && choices1 && choices1.some(Boolean) && Number.isFinite(ans1)) {
    const ai = Math.trunc(Number(ans1));
    return {
      content: content1,
      choices: choices1,
      answer_index: ai,
      points: Math.trunc(pts1),
      is_active: true,
    };
  }

  // 2) 한글 CSV 키로 온 경우
  const content = s(r["문제내용"] ?? r["문제"] ?? r["question"]);
  const choices = [
    s(r["보기1"]),
    s(r["보기2"]),
    s(r["보기3"]),
    s(r["보기4"]),
  ];

  // 정답이 2.0 처럼 들어와도 처리 (1~4 → 0~3)
  const answerNum = toNum(r["정답"], NaN);
  const answerIndex = Number.isFinite(answerNum) ? Math.trunc(answerNum) - 1 : NaN;

  const points = Math.trunc(toNum(r["배점"], 1));

  if (!content) return null;
  if (!choices.some(Boolean)) return null;
  if (!Number.isFinite(answerIndex) || answerIndex < 0 || answerIndex > 3) return null;

  return {
    content,
    choices,
    answer_index: answerIndex,
    points,
    is_active: true,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rows = (body?.rows ?? []) as IncomingRow[];

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "NO_ROWS" }, { status: 400 });
    }

    const payload: any[] = [];
    const rejected: { i: number; reason: string; sample?: any }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const n = normalizeRow(rows[i]);
      if (!n) {
        rejected.push({ i, reason: "INVALID_ROW", sample: rows[i] });
        continue;
      }
      payload.push(n);
    }

    if (payload.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_VALID_ROWS",
          detail:
            "rows는 받았지만 유효한 문항이 0건입니다. content/choices/정답/배점 형식을 확인하세요.",
          rejected_preview: rejected.slice(0, 5),
        },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from(TABLE).insert(payload);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "CSV_INSERT_FAILED", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      inserted: payload.length,
      rejected: rejected.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CSV_API_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
