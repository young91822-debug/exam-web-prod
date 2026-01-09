// app/api/admin/questions/update/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TABLE = "questions";

// ✅ TS 타입 폭발 방지: 이 파일에서만 any로 끊기
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = s(body?.id);

    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    // ✅ 너 DB가 어떤 컬럼을 쓰는지 아직 확정이 아니라서:
    // - content/points/is_active 는 기존대로
    // - choices/correct_index 도 같이 업데이트 시도 (없으면 DB 에러 날 수 있음)
    //   → 그래서 "존재할 수도 있는" 컬럼만 patch에 넣되, 에러나면 detail로 보여주게 함
    const patch: any = {};

    if (body?.content != null) patch.content = s(body.content);
    if (body?.points != null) patch.points = Number(body.points);
    if (body?.is_active != null) patch.is_active = !!body.is_active;

    // 보기/정답
    if (body?.choices != null) patch.choices = body.choices; // jsonb/array 컬럼일 때
    if (body?.correct_index != null) patch.correct_index = Number(body.correct_index);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "EMPTY_PATCH" }, { status: 400 });
    }

    // ✅ 업데이트 (로직 유지, 타입추론은 sb(any)로 차단)
    const { data, error } = await sb
      .from(TABLE)
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

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
