// app/api/exam/start/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function upperTeam(v: any) {
  const t = s(v);
  return (t ? t.toUpperCase() : "A") as string;
}
function n(v: any, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") || "";
  const parts = raw.split(";").map((x) => x.trim());
  for (const p of parts) {
    if (!p) continue;
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  return (
    (low.includes("does not exist") && low.includes(col.toLowerCase())) ||
    msg.includes(`Could not find the '${col}' column`)
  );
}

/**
 * ✅ accounts에서 team/role/is_active를 "안 터지게" 가져오기
 * - 어떤 컬럼이 없어도 단계적 fallback
 * - username 컬럼은 있으면 쓰고, 없으면 스킵
 * - role/is_active/team 컬럼이 없어도 기본값으로 진행
 */
async function pickAccountInfo(loginId: string) {
  // 1) emp_id 기준으로 시도 (풀 컬럼)
  let r = await sb
    .from("accounts")
    .select("emp_id, team, role, is_active")
    .eq("emp_id", loginId)
    .maybeSingle();

  // ✅ select에 없는 컬럼 때문에 터지면 -> 최소 컬럼로 재시도
  if (
    r.error &&
    (isMissingColumn(r.error, "role") ||
      isMissingColumn(r.error, "is_active") ||
      isMissingColumn(r.error, "team"))
  ) {
    r = await sb
      .from("accounts")
      .select("emp_id, team") // 최소
      .eq("emp_id", loginId)
      .maybeSingle();
  }

  if (r.error) throw r.error;

  if (r.data) {
    return {
      found: true as const,
      emp_id: s(r.data.emp_id) || loginId,
      team: upperTeam((r.data as any).team || "A"),
      role: s((r.data as any).role || "user") || "user",
      is_active: (r.data as any).is_active === false ? false : true,
      matchedBy: "emp_id" as const,
      hasRoleCol: (r.data as any).role !== undefined,
      hasActiveCol: (r.data as any).is_active !== undefined,
    };
  }

  // 2) username fallback (username 컬럼 없으면 스킵)
  let r2 = await sb
    .from("accounts")
    .select("emp_id, team, role, is_active")
    .eq("username", loginId)
    .maybeSingle();

  if (r2.error) {
    if (isMissingColumn(r2.error, "username")) {
      return { found: false as const };
    }
    // role/is_active/team 없어서 터진 경우 최소로 재시도
    if (
      isMissingColumn(r2.error, "role") ||
      isMissingColumn(r2.error, "is_active") ||
      isMissingColumn(r2.error, "team")
    ) {
      r2 = await sb
        .from("accounts")
        .select("emp_id, team")
        .eq("username", loginId)
        .maybeSingle();
      if (r2.error) {
        if (isMissingColumn(r2.error, "username")) return { found: false as const };
        throw r2.error;
      }
    } else {
      throw r2.error;
    }
  }

  if (!r2.data) return { found: false as const };

  return {
    found: true as const,
    emp_id: s(r2.data.emp_id) || loginId,
    team: upperTeam((r2.data as any).team || "A"),
    role: s((r2.data as any).role || "user") || "user",
    is_active: (r2.data as any).is_active === false ? false : true,
    matchedBy: "username" as const,
    hasRoleCol: (r2.data as any).role !== undefined,
    hasActiveCol: (r2.data as any).is_active !== undefined,
  };
}

/** ✅ 팀 → 소유 관리자 고정 매핑 */
function mapOwnerAdminByTeam(team: string) {
  const t = upperTeam(team);
  // B팀은 admin_gs, 그 외는 admin
  return t === "B" ? "admin_gs" : "admin";
}

export async function POST(req: Request) {
  try {
    const empId = s(getCookie(req, "empId"));
    const cookieRole = s(getCookie(req, "role")).toLowerCase(); // login API cookie

    if (!empId) {
      return NextResponse.json({ ok: false, error: "NO_SESSION" }, { status: 401 });
    }

    const info: any = await pickAccountInfo(empId);

    if (!info?.found) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_NOT_FOUND", detail: { empId } },
        { status: 401 }
      );
    }

    // ✅ 비활성
    if (info.is_active === false) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }

    // ✅ 관리자 차단
    const dbRole = s(info.role).toLowerCase();
    const effectiveRole = dbRole && dbRole !== "user" ? dbRole : cookieRole || "user";
    if (effectiveRole === "admin") {
      return NextResponse.json(
        { ok: false, error: "ADMIN_CANNOT_TAKE_EXAM", detail: { empId, matchedBy: info.matchedBy } },
        { status: 403 }
      );
    }

    const team = upperTeam(info.team || "A");

    // ✅ 내 팀 문제만
    const q1 = await sb
      .from("questions")
      .select("id, content, choices, points, is_active, team")
      .eq("team", team)
      .eq("is_active", true)
      .limit(5000);

    // is_active 컬럼 없을 수 있으니 fallback
    let qrows: any[] | null = null;

    if (!q1.error) {
      qrows = q1.data || [];
    } else {
      if (isMissingColumn(q1.error, "is_active")) {
        const q2 = await sb
          .from("questions")
          .select("id, content, choices, points, team")
          .eq("team", team)
          .limit(5000);

        if (q2.error) {
          return NextResponse.json(
            { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: q2.error },
            { status: 500 }
          );
        }
        qrows = q2.data || [];
      } else {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: q1.error },
          { status: 500 }
        );
      }
    }

    if (!qrows || qrows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS", detail: { team, note: "questions table has 0 rows for this team" } },
        { status: 500 }
      );
    }

    // ✅ 팀 기준으로 owner_admin 고정 저장
    const ownerAdmin = mapOwnerAdminByTeam(team);

    return await createAttemptAndRespond(info.emp_id || empId, team, qrows, ownerAdmin);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "START_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

async function createAttemptAndRespond(empId: string, team: string, qrows: any[], ownerAdmin: string) {
  const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
  const pickedIds = picked.map((q: any) => String(q.id));
  const totalPoints = picked.reduce((sum: number, q: any) => sum + n(q?.points, 5), 0);

  const nowIso = new Date().toISOString();

  const insertRow: any = {
    emp_id: empId,
    status: "STARTED",
    started_at: nowIso,
    submitted_at: null,
    total_questions: pickedIds.length,
    score: 0,
    question_ids: pickedIds,
    answers: {},
    team,

    // ✅ 추가: 소유 관리자(팀 기준 고정)
    owner_admin: ownerAdmin,
  };

  // owner_admin 컬럼이 아직 없으면(배포/마이그레이션 전) 터질 수 있으니 fallback
  let r1 = await sb.from("exam_attempts").insert(insertRow).select("id").single();

  if (r1.error && isMissingColumn(r1.error, "owner_admin")) {
    const { owner_admin, ...withoutOwner } = insertRow;
    r1 = await sb.from("exam_attempts").insert(withoutOwner).select("id").single();
  }

  if (r1.error || !r1.data?.id) {
    return NextResponse.json(
      { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: r1.error ?? "no id" },
      { status: 500 }
    );
  }

  const outQuestions = picked.map((q: any) => ({
    id: String(q.id),
    content: String(q.content ?? ""),
    choices: Array.isArray(q.choices)
      ? q.choices
      : typeof q.choices === "string"
      ? safeParseChoices(q.choices)
      : [],
    points: n(q?.points, 5),
  }));

  return NextResponse.json({
    ok: true,
    attemptId: String(r1.data.id),
    questions: outQuestions,
    debug: { empId, team, picked: outQuestions.length, totalPoints, owner_admin: ownerAdmin },
  });
}

function safeParseChoices(v: string): string[] {
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.map((x) => String(x ?? ""));
  } catch {}
  if (v.includes("|")) return v.split("|").map((x) => x.trim()).filter(Boolean);
  if (v.includes("\n")) return v.split("\n").map((x) => x.trim()).filter(Boolean);
  if (v.includes(",")) return v.split(",").map((x) => x.trim()).filter(Boolean);
  return v ? [v] : [];
}
