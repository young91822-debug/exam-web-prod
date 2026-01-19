// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const BATCH = 500;
const sb: any = supabaseAdmin;

const CHILD_TABLES = [
  "exam_answers",
  "attempt_answers",
  "exam_attempt_answers",
  "attempt_questions",
  "exam_attempt_questions",
  "question_answers",
  "question_options",
  "question_choices",
  "choices",
  "answers",
];

const QUESTION_FK_COL_CANDIDATES = [
  "question_id",
  "questionId",
  "question_uuid",
  "questionUuid",
  "qid",
  "question",
  "question_no",
  "questionNo",
];

function s(v: any) {
  return String(v ?? "").trim();
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
}

function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(col.toLowerCase());
}

async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId") || getCookie(cookieHeader, "userId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  // accounts 스키마가 들쭉날쭉해도 죽지 않게 여러 조합으로 조회
  const tries = [
    "emp_id,username,team,is_active,role",
    "emp_id,username,team,role",
    "emp_id,team,is_active",
    "emp_id,team",
  ];

  let data: any = null;

  for (const cols of tries) {
    const r = await sb
      .from("accounts")
      .select(cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!r.error) {
      data = r.data;
      break;
    }

    // 컬럼 없음이면 다음 시도
    const msg = String(r.error?.message || r.error);
    if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("column")) continue;

    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: msg };
  }

  // accounts row가 없더라도 기본 team은 쿠키/아이디로 결정(최후 안전장치)
  const teamFromDb = s(data?.team);
  const team = teamFromDb || (empId === "admin_gs" ? "B" : "A");

  // is_active가 있고 false면 차단
  if (data && data.is_active === false) {
    return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };
  }

  return { ok: true as const, team, empId };
}

async function tableExists(table: string) {
  const { error } = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;

  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("could not find the table") || msg.includes("relation") || msg.includes("not exist")) return false;

  // 권한/기타 에러면 존재는 한다고 보고 true
  return true;
}

async function deleteChildByQuestionIds(table: string, ids: string[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const r = await sb.from(table).delete().in(col, ids);
    if (!r.error) return { table, ok: true, by: col };

    // 컬럼 없으면 다음 후보
    if (String(r.error?.message || r.error).toLowerCase().includes("does not exist")) continue;

    return { table, ok: false, by: col, detail: String(r.error?.message || r.error) };
  }

  return { table, ok: false, detail: "No FK column matched" };
}

// (브라우저로 열었을 때 살아있는지 확인용)
export async function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.json({
    ok: true,
    marker: "CLEAR_ROUTE_PING_v2",
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    method: "Use POST to clear",
    qs: Object.fromEntries(url.searchParams.entries()),
  });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    // team 컬럼 존재 확인 (없으면 여기서 바로 에러로 알려줌)
    const test = await sb.from("questions").select("id,team").limit(1);
    if (test.error) {
      return NextResponse.json(
        { ok: false, error: "CLEAR_FAILED", detail: String(test.error.message || test.error) },
        { status: 500 }
      );
    }

    let deletedQuestions = 0;
    const childResults: any[] = [];

    while (true) {
      // ✅ 핵심: id를 "문자열(uuid)" 그대로 가져오기
      const { data: rows, error: selErr } = await sb
        .from("questions")
        .select("id")
        .eq("team", auth.team)
        .limit(BATCH);

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `SELECT failed: ${String(selErr.message || selErr)}`, team: auth.team },
          { status: 500 }
        );
      }

      const ids = (rows || []).map((r: any) => s(r?.id)).filter(Boolean);
      if (ids.length === 0) break;

      // 1) 자식 테이블 먼저 삭제
      for (const t of CHILD_TABLES) {
        const r = await deleteChildByQuestionIds(t, ids);
        childResults.push({ team: auth.team, batch: ids.length, ...r });
      }

      // 2) questions “물리 삭제”
      const { error: delErr } = await sb.from("questions").delete().in("id", ids).eq("team", auth.team);
      if (delErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `DELETE questions failed: ${String(delErr.message || delErr)}`, team: auth.team, childResults },
          { status: 500 }
        );
      }

      deletedQuestions += ids.length;
      // ✅ 계속 첫 배치부터 다시 조회 (지워졌으니 다음 배치가 당겨짐)
    }

    return NextResponse.json({
      ok: true,
      team: auth.team,
      deletedQuestions,
      marker: "ADMIN_QUESTIONS_CLEAR_HARD_DELETE_v2",
      childResultsPreview: childResults.slice(0, 12),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
