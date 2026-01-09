// app/api/admin/questions/detail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ✅ TS 타입 폭발 방지: 이 파일에서만 any로 끊기
const sb: any = supabaseAdmin;

// ✅ 405 방지: preflight/프록시가 OPTIONS로 찌르는 경우도 대응
export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    // ✅ 조회 (로직 유지, 단 타입추론은 sb(any)로 차단)
    const { data, error } = await sb
      .from("questions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DETAIL_FAILED", detail: String(error.message || error) },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DETAIL_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
