// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const BATCH = 500;

// ✅ TS 타입 폭발(무한 추론) 방지용: 이 파일에서만 any로 끊어줌
const sb: any = supabaseAdmin;

// 질문을 참조하는 컬럼명이 프로젝트마다 달라서 후보를 넉넉히 둠
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

async function requireAdminTeam(req: Request) {
  const cookieHeader = req.headers.get("cookie") || "";
  const empId = getCookie(cookieHeader, "empId");
  const role = getCookie(cookieHeader, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  const { data, error } = await sb
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (error) {
    return { ok: false as const, status: 500, error: "DB_QUERY_FAILED", detail: String(error.message || error) };
  }
  if (!data) return { ok: false as const, status: 401, error: "ACCOUNT_NOT_FOUND" };
  if (data.is_active === false) return { ok: false as const, status: 403, error: "ACCOUNT_DISABLED" };

  const team = String((data as any).team ?? "").trim() || "A";
  return { ok: true as const, team, empId };
}

async function tableExists(table: string) {
  // head + count로 존재 여부만 가볍게 체크
  const { error } = await sb.from(table).select("*", { head: true, count: "exact" }).limit(1);
  if (!error) return true;

  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("could not find the table") || msg.includes("relation")) return false;

  // 다른 에러(권한 등)면 존재는 하는데 접근문제일 수 있어서 true 취급
  return true;
}

async function deleteByQuestionIds(table: string, ids: any[]) {
  // table이 없으면 스킵
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  // FK 컬럼 후보들로 하나씩 시도
  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const { error } = await sb.from(table).delete().in(col, ids);

    if (!error) return { table, ok: true, by: col };

    const msg = String(error.message || "");

    // 컬럼 없음이면 다음 후보로 계속
    if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("does not exist")) {
      continue;
    }

    // 그 외 에러는 반환
    return { table, ok: false, by: col, detail: msg };
  }

  return { table, ok: false, detail: "No matching FK column candidates found" };
}

export async function POST(req: Request) {
  try {
    // ✅ 0) 관리자 team 인증 (A 절대 보호)
    const auth = await requireAdminTeam(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, detail: (auth as any).detail },
        { status: auth.status }
      );
    }

    // ✅ 1) questions 테이블에서 id 조회 가능한지 확인 (+ team 컬럼도 확인)
    const test = await sb.from("questions").select("id, team").limit(1);
    if (test.error) {
      return NextResponse.json(
        { ok: false, error: "CLEAR_FAILED", detail: String(test.error.message || test.error) },
        { status: 500 }
      );
    }

    const childTables = [
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

    const childResults: any[] = [];
    let deletedQuestions = 0;

    // ✅ supabase-js range는 offset 기반. team 필터를 반드시 끼워서 "내 팀 문항만" 뽑는다.
    let offset = 0;

    while (true) {
      const { data: rows, error: selErr } = await sb
        .from("questions")
        .select("id")
        .eq("team", auth.team) // ✅ 핵심: 내 팀만
        .range(offset, offset + BATCH - 1);

      if (selErr) {
        return NextResponse.json(
          {
            ok: false,
            error: "CLEAR_FAILED",
            detail: `SELECT questions failed: ${String(selErr.message || selErr)}`,
            team: auth.team,
          },
          { status: 500 }
        );
      }

      const ids = (rows || [])
        .map((r: any) => r.id)
        .filter((v: any) => v !== null && v !== undefined);

      if (ids.length === 0) break;

      // ✅ 2) FK 하위테이블 먼저 지우기 (오직 "내 팀 문항 ids"로만)
      for (const t of childTables) {
        const r = await deleteByQuestionIds(t, ids);
        childResults.push({ team: auth.team, batch: `${offset}-${offset + ids.length - 1}`, ...r });
      }

      // ✅ 3) questions 삭제 (오직 "내 팀 문항 ids"로만)
      const { error: delErr } = await sb
        .from("questions")
        .delete()
        .in("id", ids)
        .eq("team", auth.team); // ✅ 이중 안전장치(혹시 같은 id 케이스는 없지만)

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

      // ✅ offset 기반 range는 삭제하면 당겨져서 "같은 offset=0"을 계속 조회해야 함
      // 그래서 offset을 올리면 누락이 생길 수 있음.
      // -> 매번 offset=0에서 다시 BATCH만 가져와 계속 지우는 방식이 안전.
      offset = 0;
    }

    return NextResponse.json({
      ok: true,
      cleared: true,
      team: auth.team,
      deletedQuestions,
      childResults,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
