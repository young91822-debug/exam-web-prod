// app/api/admin/questions/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

export async function PATCH(req: Request, ctx: any) {
  try {
    const p = await Promise.resolve(ctx?.params);
    const id = Number(p?.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "INVALID_ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // ✅ 1) 토글/숨김/복원: is_active만 온 경우
    if (typeof body.is_active === "boolean" && Object.keys(body).length === 1) {
      const { error } = await supabaseAdmin
        .from("questions")
        .update({ is_active: body.is_active, updated_at: now })
        .eq("id", id);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, updated_at: now });
    }

    // ✅ 2) 전체 수정(모달 저장)
    const content = s(body.content);
    const choices = Array.isArray(body.choices) ? body.choices.map((v: any) => s(v)) : [];
    const answer_index = Number(body.answer_index);
    const points = Number(body.points ?? 5);
    const is_active = !!body.is_active;

    if (!content) return NextResponse.json({ ok: false, error: "문제 내용이 비었습니다." }, { status: 400 });
    if (choices.length !== 4 || choices.some((v: string) => !v))
      return NextResponse.json({ ok: false, error: "보기 4개를 모두 입력해야 합니다." }, { status: 400 });
    if (![0, 1, 2, 3].includes(answer_index))
      return NextResponse.json({ ok: false, error: "정답은 1~4 중 하나여야 합니다." }, { status: 400 });
    if (!Number.isFinite(points) || points <= 0)
      return NextResponse.json({ ok: false, error: "배점은 1 이상 숫자여야 합니다." }, { status: 400 });

    const { error } = await supabaseAdmin
      .from("questions")
      .update({
        content,
        choices,
        answer_index,
        points,
        is_active,
        updated_at: now,
      })
      .eq("id", id);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updated_at: now });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
