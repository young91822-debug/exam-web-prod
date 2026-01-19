// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const BATCH = 500;
const sb: any = supabaseAdmin;

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
  const msg = String(err?.message || err || "");
  const low = msg.toLowerCase();
  return (low.includes("column") && low.includes(col.toLowerCase()) && low.includes("does not exist")) || msg.includes(`Could not find the '${col}' column`);
}

async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  // ✅ accounts 스키마가 달라도 안 터지게 여러 조합 시도
  const tries = [
    "emp_id,team,is_active,username,role",
    "emp_id,team,username,role",
    "emp_id,team,is_active,role",
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
    const msg = String(r.error?.message || r.error);
    if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("column")) continue;
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: msg };
  }

  // accounts에 row 없어도(최악) 팀 기본 A
  const team = s(data?.team) || "A";
  const isActive = (data as any)?.is_active;
  if (isActive === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  return { ok: true as const, team, empId };
}

async function tableExists(table: string) {
  const { error } = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("could not find the table") || msg.includes("relation") || msg.includes("not find the table")) return false;
  return true; // 권한 이슈 가능 -> 존재는 하는 걸로
}

async function deleteByQuestionIds(table: string, ids: string[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const { error } = await sb.from(table).delete().in(col, ids as any);
    if (!error) return { table, ok: true, by: col };

    const msg = String(error.message || error);
    if (isMissingColumn(error, col)) continue;

    return { table, ok: false, by: col, detail: msg };
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
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

    // ✅ questions/team 컬럼 접근 확인
    const test = await sb.from("questions").select("id, team").limit(1);
    if (test.error) {
      return NextResponse.json(
        { ok: false, error: "CLEAR_FAILED", detail: String(test.error.message || test.error) },
        { status: 500 }
      );
    }

    const childTables = [
      "attempt_answers",
      "exam_answers",
      "exam_attempt_answers",
      "attempt_questions",
      "exam_attempt_questions",
      "question_answers",
      "question_options",
      "question_choices",
      "choices",
      "answers",
    ];

    const childResults: any[] = [];
    let deletedQuestions = 0;

    // ✅ 항상 0부터 다시 당겨 삭제
    while (true) {
      const { data: rows, error: selErr } = await sb
        .from("questions")
        .select("id")
        .eq("team", auth.team)
        .range(0, BATCH - 1);

      if (selErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `SELECT questions failed: ${String(selErr.message || selErr)}`, team: auth.team },
          { status: 500 }
        );
      }

      // ✅ 핵심: id를 숫자로 바꾸지 말고 "문자열 그대로" (uuid/숫자 둘다 커버)
      const ids = (rows || []).map((r: any) => s(r?.id)).filter(Boolean);

      if (ids.length === 0) break;

      // ✅ child table 먼저
      for (const t of childTables) {
        const r = await deleteByQuestionIds(t, ids);
        childResults.push({ team: auth.team, batch: `0-${ids.length - 1}`, ...r });
      }

      // ✅ questions 삭제
      const { error: delErr } = await sb
        .from("questions")
        .delete()
        .in("id", ids as any)
        .eq("team", auth.team);

      if (delErr) {
        return NextResponse.json(
          { ok: false, error: "CLEAR_FAILED", detail: `DELETE questions failed: ${String(delErr.message || delErr)}`, team: auth.team, childResults },
          { status: 500 }
        );
      }

      deletedQuestions += ids.length;
    }

    return NextResponse.json({
      ok: true,
      cleared: true,
      team: auth.team,
      deletedQuestions,
      childResults,
      marker: "ADMIN_QUESTIONS_CLEAR_HARD_v2_UUID_OK",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
