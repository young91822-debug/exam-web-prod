import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function isAdmin(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  return /(?:^|;\s*)admin=1(?:;|$)/.test(cookie);
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("accounts")
    .select("id,user_id,password,created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  const password = String(body?.password || "").trim();

  if (!userId || !password) {
    return NextResponse.json({ error: "userId/password 필요" }, { status: 400 });
  }

  // ✅ accounts.id(UUID)가 없거나 자동생성이 안 되는 경우를 대비:
  // - accounts 테이블에 id(uuid, default gen_random_uuid())가 있으면 자동으로 들어감
  // - 없으면 insert가 실패할 수 있음(그땐 DB쪽에 id 컬럼 추가 필요)
  const { data, error } = await supabaseAdmin
    .from("accounts")
    .insert([{ user_id: userId, password }])
    .select("id,user_id,password,created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const { error } = await supabaseAdmin.from("accounts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
