import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// supabase 타입 에러 방지
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: string | null, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function bool(v: string | null, d = false) {
  if (v == null) return d;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function getCookie(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.split("=")[1] ?? "";
}

/** ✅ 관리자 + 팀 확인 (emp_id 기준) */
async function requireAdminTeam(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const empId = getCookie(cookie, "empId");
  const role = getCookie(cookie, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await sb
    .from("accounts")
    .select("emp_id, team, is_active")
    .eq("emp_id", empId)
    .maybeSingle();

  if (error)
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: error.message };
  if (!data)
    return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  if (data.is_active === false)
    return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  return { ok: true as const, empId, team: data.team || "A" };
}

const TABLE = "questions";

export async function GET(req: Request) {
  const auth = await requireAdminTeam(req);
  if (!auth.ok)
    return NextResponse.json(auth, { status: auth.status });

  const u = new URL(req.url);
  const page = Math.max(1, n(u.searchParams.get("page"), 1));
  const pageSize = Math.min(200, Math.max(1, n(u.searchParams.get("pageSize"), 20)));
  const includeOff = bool(u.searchParams.get("includeOff"), true);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = sb
    .from(TABLE)
    .select("id, content, points, is_active", { count: "exact" })
    .eq("team", auth.team);

  if (!includeOff) q = q.eq("is_active", true);

  const { data, count, error } = await q
    .order("id", { ascending: false })
    .range(from, to);

  if (error)
    return NextResponse.json(
      { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: error.message },
      { status: 500 }
    );

  return NextResponse.json({
    ok: true,
    team: auth.team,
    page,
    pageSize,
    total: count ?? 0,
    items: data ?? [],
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminTeam(req);
  if (!auth.ok)
    return NextResponse.json(auth, { status: auth.status });

  const body = await req.json();
  const content = s(body.content);
  const choices = Array.isArray(body.choices) ? body.choices.map(s) : [];
  const points = Number(body.points) || 1;

  if (!content) return NextResponse.json({ ok: false, error: "MISSING_CONTENT" }, { status: 400 });
  if (choices.length < 2)
    return NextResponse.json({ ok: false, error: "MISSING_CHOICES" }, { status: 400 });

  const idx =
    body.correct_index ?? body.answer_index ?? body.correctIndex ?? null;

  const { data, error } = await sb
    .from(TABLE)
    .insert({
      content,
      choices,
      points,
      is_active: body.is_active !== false,
      team: auth.team,
      correct_index: idx,
      answer_index: idx,
    })
    .select("id, content, points, is_active")
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: "QUESTION_INSERT_FAILED", detail: error.message },
      { status: 500 }
    );

  return NextResponse.json({ ok: true, item: data });
}
