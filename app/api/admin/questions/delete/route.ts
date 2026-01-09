// app/api/admin/questions/delete/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ✅ TS 타입 폭발 방지: 이 파일에서만 any로 끊기
const sb: any = supabaseAdmin;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body;

    console.log("🔥 DELETE API id =", id);

    // ✅ 방어
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { ok: false, error: "INVALID_ID", received: id },
        { status: 400 }
      );
    }

    // ✅ 삭제 (원래 로직 유지)
    // - 타입 추론이 여기서 폭발하므로 sb(any) 사용
    const { error, count } = await sb
      .from("questions")
      .delete({ count: "exact" })
      .eq("id", id);

    console.log("🔥 DELETE count =", count);

    if (error) {
      return NextResponse.json(
        { ok: false, error: String(error.message || error) },
        { status: 500 }
      );
    }

    if (count === 0) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
