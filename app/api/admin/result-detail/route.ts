// app/api/admin/result-detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
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

/** query param을 대소문자 무시하고 가져오기 */
function getParamCI(u: URL, ...keys: string[]) {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  for (const [k, v] of u.searchParams.entries()) {
    if (want.has(k.toLowerCase())) return v;
  }
  return null;
}

function isNumericId(x: string) {
  return /^\d+$/.test(x);
}
function upperTeam(v: any) {
  const t = s(v).toUpperCase();
  return t === "B" ? "B" : "A";
}

/** ✅ UUID 검증 (questions.id가 uuid라서 필수 안전장치) */
function isUUID(v: any) {
  const x = s(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

/**
 * ✅ 관리자 팀 가드
 * - owner_admin 있으면 우선 owner_admin === adminEmpId
 * - 아니면 attempt.team === adminTeam
 * - team null(레거시)은 일단 허용
 */
function authorizeAdminForAttempt(adminEmpId: string, adminTeam: "A" | "B", attempt: any) {
  const owner = s(attempt?.owner_admin);
  if (owner) return owner === adminEmpId;

  const attemptTeam = s(attempt?.team);
  if (attemptTeam) return upperTeam(attemptTeam) === adminTeam;

  return true;
}

function pickChoices(q: any): string[] {
  const c =
    q?.choices ??
    q?.options ??
    q?.choice_list ??
    q?.choiceList ??
    q?.choice_texts ??
    q?.choiceTexts ??
    [];
  if (Array.isArray(c)) return c.map((x) => String(x ?? ""));
  if (typeof c === "string") {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? ""));
    } catch {}
    if (c.includes("|")) return c.split("|").map((x) => x.trim()).filter(Boolean);
    if (c.includes("\n")) return c.split("\n").map((x) => x.trim()).filter(Boolean);
    if (c.includes(",")) return c.split(",").map((x) => x.trim()).filter(Boolean);
    return [c];
  }
  return [];
}

function pickCorrectIndex(q: any): number | null {
  const cands = [
    q?.correct_index,
    q?.correctIndex,
    q?.answer_index,
    q?.answerIndex,
    q?.correct_answer,
    q?.correctAnswer,
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/* ---------------- answers sources ---------------- */

/** attempt.answers에서 map 추출 */
function parseAnswersFromAttemptColumn(attempt: any): Record<string, number> {
  let a: any = attempt?.answers;

  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch {
      a = null;
    }
  }

  const mapObj =
    (a?.map && typeof a.map === "object" ? a.map : null) ??
    (a && typeof a === "object" ? a : null) ??
    {};

  const map: Record<string, number> = {};
  for (const [k, v] of Object.entries(mapObj)) {
    const idx = n(v, null);
    if (k && idx !== null) map[String(k).trim()] = Number(idx);
  }
  return map;
}

/** ✅ exam_answers 테이블에서 map 만들기 (attempt_id 기준) */
async function loadAnswersFromExamAnswers(attemptId: number) {
  // selected_index 컬럼명은 submit 코드가 쓰는 그대로
  const r = await supabaseAdmin
    .from("exam_answers")
    .select("question_id, selected_index")
    .eq("attempt_id", attemptId);

  if (r.error) return { ok: false as const, error: r.error };

  const map: Record<string, number> = {};
  for (const row of r.data ?? []) {
    const qid = s((row as any)?.question_id);
    const idx = n((row as any)?.selected_index, null);
    if (!qid || idx === null) continue;
    map[qid] = Number(idx);
  }
  return { ok: true as const, map, rows: (r.data ?? []).length };
}

/** (있으면) attempt_answers 테이블에서 map 만들기 */
async function loadAnswersFromAttemptAnswers(attemptId: number) {
  const r = await supabaseAdmin
    .from("attempt_answers")
    .select("question_id, selected_index, attempt_id")
    .eq("attempt_id", attemptId);

  if (r.error) return { ok: false as const, error: r.error };

  const map: Record<string, number> = {};
  for (const row of r.data ?? []) {
    const qid = s((row as any)?.question_id);
    const idx = n((row as any)?.selected_index, null);
    if (!qid || idx === null) continue;
    map[qid] = Number(idx);
  }
  return { ok: true as const, map, rows: (r.data ?? []).length };
}

/* ---------------- main builder ---------------- */

async function buildDetailFromExamAttempts(attempt: any) {
  const attemptId = n(attempt?.id, null);

  // ✅ question_ids 안전 정리 (uuid만 통과)
  const rawIds: string[] = Array.isArray(attempt?.question_ids)
    ? attempt.question_ids.map((x: any) => s(x)).filter(Boolean)
    : [];

  const questionIds = rawIds.filter((x) => isUUID(x));

  // ✅ 1) attempt.answers 우선
  let answersMap = parseAnswersFromAttemptColumn(attempt);
  let answersSource = "exam_attempts.answers";
  let answersRows = 0;

  // ✅ 2) 비어있으면 exam_answers에서 가져오기
  if (Object.keys(answersMap).length === 0 && attemptId) {
    const r2 = await loadAnswersFromExamAnswers(attemptId);
    if (r2.ok && Object.keys(r2.map).length > 0) {
      answersMap = r2.map;
      answersSource = "exam_answers";
      answersRows = r2.rows;
    }
  }

  // ✅ 3) 그래도 비어있으면 attempt_answers 시도(있을 때만)
  if (Object.keys(answersMap).length === 0 && attemptId) {
    const r3 = await loadAnswersFromAttemptAnswers(attemptId);
    if (r3.ok && Object.keys(r3.map).length > 0) {
      answersMap = r3.map;
      answersSource = "attempt_answers";
      answersRows = r3.rows;
    }
  }

  // ✅ questions 조회
  // - questionIds가 비어있으면 "조회 자체를 안 함" (중요)
  let questions: any[] = [];
  if (questionIds.length > 0) {
    const qr = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", questionIds as any);

    if (qr.error) return { ok: false as const, error: "QUESTIONS_QUERY_FAILED", detail: qr.error };
    questions = qr.data ?? [];
  }

  const qById = new Map<string, any>();
  for (const q of questions ?? []) qById.set(String((q as any).id), q);

  // graded는 원래 attempt.question_ids 기준으로 "순서" 유지하고 싶을 수 있음
  // 근데 uuid 아닌 값은 아예 문제라서 제외하는 게 안전
  const gradedIds = questionIds;

  const graded = gradedIds.map((qid) => {
    const q = qById.get(String(qid)) ?? {};
    const key = String(qid).trim();

    const selectedIndex =
      Object.prototype.hasOwnProperty.call(answersMap, key) ? Number(answersMap[key]) : null;

    const correctIndex = pickCorrectIndex(q);

    const status = selectedIndex == null ? "unsubmitted" : "submitted";
    const isCorrect =
      status === "submitted" && correctIndex != null
        ? Number(selectedIndex) === Number(correctIndex)
        : false;

    return {
      questionId: q?.id ?? qid,
      question_id: q?.id ?? qid,

      content: q?.content ?? "",
      choices: pickChoices(q),

      selectedIndex,
      selected_index: selectedIndex,

      correctIndex,
      correct_index: correctIndex,

      status,
      isCorrect,
      is_correct: isCorrect,
    };
  });

  // ✅ 100점 환산
  const totalQ = graded.length;
  const submittedQ = graded.filter((g: any) => g.status === "submitted").length;
  const correctQ = graded.filter((g: any) => g.is_correct === true).length;
  const wrongQ = graded.filter((g: any) => g.status === "submitted" && g.is_correct === false).length;

  const score100 = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

  const patchedAttempt = {
    ...attempt,
    total_questions: totalQ,
    wrong_count: wrongQ,
    correct_count: correctQ,
    score: score100,
    total_points: 100,
  };

  return {
    ok: true as const,
    attempt: patchedAttempt,
    graded,
    meta: {
      idType: "num",
      source: "exam_attempts + questions",
      answersSource,
      answersRows,
      totalQ,
      submittedQ,
      correctQ,
      wrongQ,
      score100,
      mapKeysCount: Object.keys(answersMap).length,
      rawQuestionIdsCount: rawIds.length,
      filteredQuestionIdsCount: questionIds.length,
    },
  };
}

/* ---------------- handler ---------------- */

export async function GET(req: Request) {
  try {
    const adminEmpId = s(getCookie(req, "empId"));
    const role = s(getCookie(req, "role"));
    const teamCookie = s(getCookie(req, "team"));

    if (!adminEmpId || role !== "admin") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const adminTeam = upperTeam(teamCookie || (adminEmpId === "admin_gs" ? "B" : "A")) as "A" | "B";

    const u = new URL(req.url);
    const raw =
      getParamCI(u, "attemptId", "attempt_id", "attemptID", "attemptid", "id", "AttemptId", "AttemptID") ?? "";
    const attemptKey = s(raw);

    if (!attemptKey) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    if (!isNumericId(attemptKey)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    const attemptId = n(attemptKey, null);
    if (!attemptId || attemptId <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    const r = await supabaseAdmin.from("exam_attempts").select("*").eq("id", attemptId).maybeSingle();
    if (r.error) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: r.error }, { status: 500 });
    }

    const attempt = r.data;
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });

    if (!authorizeAdminForAttempt(adminEmpId, adminTeam, attempt)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const detail = await buildDetailFromExamAttempts(attempt);
    if (!detail.ok) {
      return NextResponse.json({ ok: false, error: detail.error, detail: (detail as any).detail }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      attempt: detail.attempt,
      graded: detail.graded,
      meta: { ...(detail as any).meta, adminTeam },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "RESULT_DETAIL_UNHANDLED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
