// app/api/admin/questions/clear/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

/* ------------------ utils ------------------ */
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

async function requireAdmin(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const empId = getCookie(cookie, "empId");
  const role = getCookie(cookie, "role");

  if (!empId) return { ok: false as const, status: 401, error: "NO_SESSION" };
  if (role !== "admin") return { ok: false as const, status: 403, error: "NOT_ADMIN" };

  return { ok: true as const, empId };
}

function looksTableMissing(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("could not find the table") || msg.includes("relation") || msg.includes("does not exist");
}

async function tableExists(table: string) {
  const { error } = await sb.from(table).select("*", { head: true }).limit(1);
  if (!error) return true;
  if (looksTableMissing(error)) return false;
  // 권한 문제 등은 존재하는 걸로 취급
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

/** 특정 자식테이블에서 question FK컬럼 후보로 in-delete 시도 */
async function deleteChildByQuestionIds(table: string, ids: any[]) {
  const exists = await tableExists(table);
  if (!exists) return { table, skipped: true, detail: "table not found" };

  for (const col of QUESTION_FK_COL_CANDIDATES) {
    const res = await sb.from(table).delete().in(col, ids);
    if (!res.error) return { table, ok: true, by: col, deleted: true };

    const msg = String(res.error?.message || res.error || "").toLowerCase();
    if (msg.includes("column") && msg.includes("does not exist")) continue;

    return { table, ok: false, by: col, detail: String(res.error?.message || res.error) };
  }

  return { table, ok: false, detail: "no fk column matched" };
}

/* ------------------ POST (REAL DELETE) ------------------ */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    // 0) questions id 전부 가져오기 (uuid/number 상관없이 그대로)
    const { data: qrows, error: selErr } = await sb.from("questions").select("id");
    if (selErr) {
      return NextResponse.json(
        { ok: false, error: "SELECT_FAILED", detail: String(selErr.message || selErr) },
        { status: 500 }
      );
    }

    const ids = (qrows || []).map((r: any) => r?.id).filter((v: any) => v !== null && v !== undefined);
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, deleted: true, deletedQuestions: 0, marker: "QUESTIONS_ALREADY_EMPTY" });
    }

    // 1) 자식 테이블들 FK 먼저 정리 (있으면 지움 / 없으면 스킵)
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

    const childResults: any[] = [];
    for (const t of childTables) {
      const r = await deleteChildByQuestionIds(t, ids);
      childResults.push(r);
      // 자식 삭제가 “권한/기타 에러”로 막히면 여기서 바로 중단하는 게 안전
      if (r.ok === false && !r.skipped) {
        return NextResponse.json(
          { ok: false, error: "CHILD_DELETE_FAILED", detail: r, childResults },
          { status: 500 }
        );
      }
    }

    // 2) questions 완전 삭제 (id in 으로 확실하게)
    const { error: delErr } = await sb.from("questions").delete().in("id", ids);
    if (delErr) {
      return NextResponse.json(
        { ok: false, error: "DELETE_FAILED", detail: String(delErr.message || delErr), childResults },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
      deletedQuestions: ids.length,
      childResults,
      marker: "QUESTIONS_HARD_DELETE_OK_v2",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "CLEAR_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
