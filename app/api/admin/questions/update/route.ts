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
function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * 너 DB 스키마(스샷 기준):
 * - 정답: answer_index (int)
 * - 보기: choice1~choice4 (text)
 *
 * 프론트는 choices[]로 보냄 → 여기서 choice1~4로 매핑 저장
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = s(body?.id);

    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const patch: any = {};

    // 기본
    if (body?.content != null) patch.content = s(body.content);
    if (body?.points != null) patch.points = Number(body.points);
    if (body?.is_active != null) patch.is_active = !!body.is_active;

    // ✅ 정답: answer_index
    if (body?.answer_index != null) patch.answer_index = n(body.answer_index, 0);

    // ✅ 보기: choices[] 또는 choice1~4
    if (Array.isArray(body?.choices)) {
      const arr = body.choices.map((x: any) => String(x ?? ""));
      patch.choice1 = arr[0] ?? "";
      patch.choice2 = arr[1] ?? "";
      patch.choice3 = arr[2] ?? "";
      patch.choice4 = arr[3] ?? "";
    } else {
      if (body?.choice1 != null) patch.choice1 = s(body.choice1);
      if (body?.choice2 != null) patch.choice2 = s(body.choice2);
      if (body?.choice3 != null) patch.choice3 = s(body.choice3);
      if (body?.choice4 != null) patch.choice4 = s(body.choice4);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "EMPTY_PATCH" }, { status: 400 });
    }

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
