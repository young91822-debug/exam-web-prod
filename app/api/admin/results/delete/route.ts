// app/api/admin/results/delete/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function isNumericId(x: string) {
  return /^\d+$/.test(x);
}

/** cookie 파싱 (Request 환경) */
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

async function safeDelete(table: string, whereCol: string, whereVal: any) {
  try {
    const { error } = await sb.from(table).delete().eq(whereCol, whereVal);
    // 테이블이 없거나 컬럼 없을 때는 그냥 무시
    if (error) {
      const msg = String(error.message || error);
      if (
        msg.includes("does not exist") ||
        msg.includes("schema cache") ||
        msg.includes("column") ||
        msg.includes("relation")
      ) {
        return { ok: true, skipped: true, table, error: msg };
      }
      return { ok: false, table, error: msg };
    }
    return { ok: true, skipped: false, table };
  } catch (e: any) {
    const msg = String(e?.message || e);
    return { ok: false, table, error: msg };
  }
}

export async function POST(req: Request) {
  try {
    // ✅ 관리자만 허용 (너희 시스템 쿠키 기준)
    const role = s(getCookie(req, "role"));
    const empId = s(getCookie(req, "empId"));
    if (!empId || role !== "admin") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const attemptIdRaw = s(body?.attemptId ?? body?.id);
    if (!attemptIdRaw) {
      return NextResponse.json({ ok: false, error: "MISSING_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ 시도: 숫자면 숫자로도 삭제, 문자열로도 삭제 (테이블마다 타입 다를 수 있음)
    const attemptIdNum = isNumericId(attemptIdRaw) ? Number(attemptIdRaw) : null;

    // ✅ 관련 테이블들 먼저 삭제 (FK 있으면 이 순서가 안전)
    const targets = [
      // 답안/선택지 기록류 (프로젝트마다 이름 다름)
      ["attempt_answers", "attempt_id"],
      ["exam_answers", "attempt_id"],
      ["answers", "attempt_id"],

      // 응시 문항 매핑류
      ["attempt_questions", "attempt_id"],
      ["exam_attempt_questions", "attempt_id"],

      // 결과 상세 테이블이 따로 있는 경우
      ["exam_results", "attempt_id"],

      // 일부는 attemptId 컬럼명이 id일 수도 있어서 추가 커버(있으면 지워짐)
      ["attempt_answers", "attemptId"],
      ["attempt_questions", "attemptId"],
      ["exam_answers", "attemptId"],
    ] as const;

    const logs: any[] = [];

    for (const [table, col] of targets) {
      logs.push(await safeDelete(table, col, attemptIdRaw));
      if (attemptIdNum !== null) logs.push(await safeDelete(table, col, attemptIdNum));
    }

    // ✅ 마지막: attempts 본체 삭제 (너희가 쓰는 테이블명 커버)
    const attemptTables = ["exam_attempts", "attempts"] as const;

    let deleted = false;
    for (const t of attemptTables) {
      // id 컬럼으로 삭제
      const r1 = await safeDelete(t, "id", attemptIdRaw);
      logs.push(r1);
      if (attemptIdNum !== null) logs.push(await safeDelete(t, "id", attemptIdNum));

      // attempt_id 컬럼으로도 커버
      logs.push(await safeDelete(t, "attempt_id", attemptIdRaw));
      if (attemptIdNum !== null) logs.push(await safeDelete(t, "attempt_id", attemptIdNum));

      if ((r1 as any).ok && !(r1 as any).skipped) deleted = true;
    }

    return NextResponse.json({ ok: true, attemptId: attemptIdRaw, deleted, logs });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DELETE_FAILED", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
