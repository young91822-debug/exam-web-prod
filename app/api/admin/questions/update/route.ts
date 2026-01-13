// app/api/admin/questions/update/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TABLE = "questions";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * 프론트: { id, content, points, is_active, choices[], correct_index }
 * DB: choices(json/array) 또는 choice1~4 / 정답컬럼(correct_index/answer_index 등) 프로젝트마다 다를 수 있음
 *
 * ✅ 지금까지 네 프로젝트 흐름에 맞춰:
 * - content/points/is_active 업데이트
 * - choices[]는 그대로 choices 컬럼이 있으면 저장
 * - correct_index도 컬럼이 있으면 저장
 *
 * (만약 DB가 choice1~4, answer_index면 여기 매핑만 바꾸면 됨)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = s(body?.id);

    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const patch: any = {};
    if (body?.content != null) patch.content = s(body.content);
    if (body?.points != null) patch.points = n(body.points, 1) ?? 1;
    if (body?.is_active != null) patch.is_active = !!body.is_active;

    // ✅ choices 컬럼이 있는 스키마(네가 /api/exam/start 에서 쓰는 방식) 기준
    if (Array.isArray(body?.choices)) patch.choices = body.choices.map((x: any) => String(x ?? ""));

    // ✅ correct_index 컬럼 기준(네 CSV 업로드/프론트가 쓰는 키)
    if (body?.correct_index != null) patch.correct_index = n(body.correct_index, 0) ?? 0;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "EMPTY_PATCH" }, { status: 400 });
    }

    const { data, error } = await sb.from(TABLE).update(patch).eq("id", id).select("*").maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "UPDATE_FAILED", detail: String(error.message || error), patch },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, item: data ?? null });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UPDATE_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
