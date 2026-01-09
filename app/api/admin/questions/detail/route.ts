// app/api/admin/questions/detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ✅ 405 방지: preflight/프록시가 OPTIONS로 찌르는 경우도 대응
export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("questions")
      .select("*")
      .eq("id" as any, id as any)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DETAIL_FAILED", detail: error.message },
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
