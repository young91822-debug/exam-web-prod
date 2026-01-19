// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sb: any = supabaseAdmin;
const BATCH = 500;

function s(v: any) {
  return String(v ?? "").trim();
}

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((x) => x.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

function isMissingColumn(err: any, table: string, col: string) {
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  return (
    low.includes(`column ${table.toLowerCase()}.${col.toLowerCase()} does not exist`) ||
    low.includes(`could not find the '${col.toLowerCase()}' column`) ||
    (low.includes(col.toLowerCase()) && low.includes("does not exist"))
  );
}

async function requireAdminTeam(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const empId = getCookie(cookie, "empId") || getCookie(cookie, "userId");
  const role = getCookie(cookie, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  // accounts 스키마가 환경마다 달라서 안전하게 조회
  const tries = [
    "emp_id,team,role,is_active,username",
    "emp_id,team,role,is_active",
    "emp_id,team,role",
    "emp_id,team",
  ];

  let row: any = null;

  for (const cols of tries) {
    const r = await sb
      .from("accounts")
      .select(cols)
      .or(`emp_id.eq.${empId},username.eq.${empId},user_id.eq.${empId}`)
      .maybeSingle();

    if (!r.error) {
      row = r.data;
      break;
    }
    if (isMissingColumn(r.error, "accounts", "username") || String(r.error?.message || "").includes("does not exist")) {
      continue;
    }
    return {
      ok: false as const,
      status: 500,
      error: "DB_QUERY_FAILED",
      detail: String(r.error?.message || r.error),
    };
  }

  // team이 비었으면 admin_gs만 B, 나머지 A
  const team = s(row?.team) || (empId === "admin_gs" ? "B" : "A");

  // is_active 컬럼이 있으면 비활성 체크
  if (row && row.is_active === false) {
    return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };
  }

  return { ok: true as const, empId, team };
}

/** GET으로 열었을 때 405 대신 안내용 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  return NextResponse.json({
    ok: true,
    marker: "CLEAR_ROUTE_PING",
    method: "Use POST to clear questions",
    path: u.pathname,
  });
}

/** 테이블 존재 여부(없으면 스킵) */
async function tableExists(table: string) {
  const { error } = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;

  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("could not find the table") || msg.includes("relation") || msg.includes("not found")) return false;

  // 권한/기타면 존재는 할 수 있으니 true 취급
  return true;
}

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

async function deleteByQuestionIds(table: string, ids: string[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const r = await sb.from(table).delete().in(col, ids);
    if (!r.error) return { table, ok: true, by: col };

    if (isMissingColumn(r.error, table, col)) continue;

    // 그 외 에러는 리턴
    return { table, ok: false, by: col, detail: String((r.error as any).message || r.error) };
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
}

/** POST: 진짜 하드 삭제 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    // 자식 테이블(프로젝트별 이름 다양해서 넉넉히)
    const childTables = [
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

    let deletedQuestions = 0;
    const childResults: any[] = [];

    while (true) {
      // ✅ 여기서 IMPORTANT: id를 절대 Number()로 바꾸지 말 것 (uuid면 다 날아감)
      const { data: rows, error: selErr } = await sb
        .from("questions")
        .select("id")
        .eq("team", auth.team)
        .limit(BATCH);

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `SELECT questions failed: ${String(selErr.message || selErr)}` },
          { status: 500 }
        );
      }

      const ids = (rows || []).map((r: any) => s(r?.id)).filter(Boolean);
      if (ids.length === 0) break;

      // 1) 자식 테이블 먼저 삭제
      for (const t of childTables) {
        const rr = await deleteByQuestionIds(t, ids);
        childResults.push({ team: auth.team, batchSize: ids.length, ...rr });
      }

      // 2) questions 하드삭제
      const { error: delErr } = await sb.from("questions").delete().in("id", ids).eq("team", auth.team);
      if (delErr) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_FAILED",
            detail: `DELETE questions failed: ${String(delErr.message || delErr)}`,
            team: auth.team,
            childResults,
          },
          { status: 500 }
        );
      }

      deletedQuestions += ids.length;
    }

    return NextResponse.json({
      ok: true,
      marker: "QUESTIONS_HARD_CLEAR_OK",
      team: auth.team,
      deletedQuestions,
      childResultsPreview: childResults.slice(0, 20),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
