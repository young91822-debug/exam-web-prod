// app/api/admin/examinees/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

function s(v: any) {
  return String(v ?? "").trim();
}

function errJson(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("examinees")
    .select("id, emp_id, name, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return errJson(500, {
      ok: false,
      error: "LIST_FAILED",
      detail: error.message,
      code: (error as any).code ?? null,
      hint: (error as any).hint ?? null,
    });
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));

  const emp_id = s(body.emp_id);
  const name = s(body.name);
  const password = s(body.password);

  if (!emp_id || !password) {
    return errJson(400, {
      ok: false,
      error: "REQUIRED",
      detail: "emp_id / password는 필수",
    });
  }

  const { data, error } = await supabaseAdmin
    .from("examinees")
    .insert([
      {
        emp_id,
        name: name || null,
        password,
        is_active: true,
      },
    ])
    .select("id, emp_id, name, is_active, created_at")
    .single();

  if (error) {
    const code = (error as any).code ?? null;

    // ✅ emp_id UNIQUE 중복 (Postgres 23505)
    if (code === "23505") {
      return errJson(409, {
        ok: false,
        error: "DUPLICATE_EMP_ID",
        detail: `이미 존재하는 emp_id야: ${emp_id}`,
        code,
      });
    }

    return errJson(500, {
      ok: false,
      error: "CREATE_FAILED",
      detail: error.message,
      code,
      hint: (error as any).hint ?? null,
    });
  }

  return NextResponse.json({ ok: true, item: data });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const id = Number(body.id);

  if (!id) {
    return errJson(400, { ok: false, error: "REQUIRED", detail: "id required" });
  }

  const patch: any = {};
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  if (body.name !== undefined) {
    const name = s(body.name);
    patch.name = name ? name : null;
  }

  if (body.password !== undefined) {
    const pw = s(body.password);
    if (!pw) {
      return errJson(400, { ok: false, error: "REQUIRED", detail: "password required" });
    }
    patch.password = pw;
  }

  if (Object.keys(patch).length === 0) {
    return errJson(400, { ok: false, error: "NO_FIELDS", detail: "no fields to update" });
  }

  const { data, error } = await supabaseAdmin
    .from("examinees")
    .update(patch)
    .eq("id", id)
    .select("id, emp_id, name, is_active, created_at")
    .single();

  if (error) {
    return errJson(500, {
      ok: false,
      error: "UPDATE_FAILED",
      detail: error.message,
      code: (error as any).code ?? null,
      hint: (error as any).hint ?? null,
    });
  }

  return NextResponse.json({ ok: true, item: data });
}
