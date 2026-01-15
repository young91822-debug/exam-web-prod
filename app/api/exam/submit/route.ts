// app/api/exam/submit/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) return { client: null as any, error: "Missing env: NEXT_PUBLIC_SUPABASE_URL" };
  if (!service) return { client: null as any, error: "Missing env: SUPABASE_SERVICE_ROLE_KEY" };

  const client = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { client, error: null as string | null };
}

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function isNumericId(v: any) {
  const t = s(v);
  return /^\d+$/.test(t);
}
function isUUID(v: any) {
  const t = s(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
}

function normalizeQid(v: any): number | string | null {
  const t = s(v);
  if (!t) return null;
  if (isNumericId(t)) return Number(t);
  return t;
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

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      if (!t) return {};
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
}

function pickCorrectIndex(q: any): number | null {
  const cands = [
    q?.correct_index,
    q?.correctIndex,
    q?.answer_index,
    q?.answerIndex,
    q?.correct_answer,
    q?.correctAnswer,
    q?.correct_choice,
    q?.correctChoice,
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

type AnswerItem = { questionId: string; selectedIndex: number };

function normalizeAnswers(body: any): AnswerItem[] {
  const raw =
    body?.answers ??
    body?.selected ??
    body?.answerMap ??
    body?.items ??
    body?.payload?.answers ??
    null;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((x) => ({
        questionId: s(x?.questionId ?? x?.question_id ?? x?.qid ?? x?.id),
        selectedIndex: n(x?.selectedIndex ?? x?.selected_index ?? x?.value, null) as any,
      }))
      .filter((x) => x.questionId && x.selectedIndex !== null);
  }

  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([qid, idx]) => ({
        questionId: s(qid),
        selectedIndex: n(idx, null) as any,
      }))
      .filter((x) => x.questionId && x.selectedIndex !== null);
  }

  return [];
}

function resolveAttemptIdRaw(req: Request, body: any) {
  try {
    const u = new URL(req.url);
    const q =
      u.searchParams.get("attemptId") ||
      u.searchParams.get("attempt_id") ||
      u.searchParams.get("attemptID");
    if (q) {
      const qs = s(q);
      if (isUUID(qs)) return { attemptIdRaw: qs as string | number, resolvedBy: "QUERY_UUID" };
      const qNum = n(qs, null);
      if (qNum !== null && qNum > 0) return { attemptIdRaw: qNum as string | number, resolvedBy: "QUERY_NUMBER" };
    }
  } catch {}

  const fromBody =
    body?.attemptId ??
    body?.attempt_id ??
    body?.attemptID ??
    body?.AttemptId ??
    body?.AttemptID ??
    body?.id ??
    body?.attempt?.id;

  if (fromBody !== undefined && fromBody !== null && fromBody !== "") {
    const bs = s(fromBody);
    if (isUUID(bs)) return { attemptIdRaw: bs as string | number, resolvedBy: "BODY_UUID" };
    const bodyNum = n(bs, null);
    if (bodyNum !== null && bodyNum > 0) return { attemptIdRaw: bodyNum as string | number, resolvedBy: "BODY_NUMBER" };
  }

  const cAttemptRaw = getCookie(req, "attemptId") || getCookie(req, "attempt_id");
  if (cAttemptRaw) {
    const cs = s(cAttemptRaw);
    if (isUUID(cs)) return { attemptIdRaw: cs as string | number, resolvedBy: "COOKIE_UUID" };
    const cNum = n(cs, null);
    if (cNum !== null && cNum > 0) return { attemptIdRaw: cNum as string | number, resolvedBy: "COOKIE_NUMBER" };
  }

  return { attemptIdRaw: null as any, resolvedBy: "NONE", detail: { url: req.url, keys: Object.keys(body ?? {}) } };
}

/** question_ids를 attempt에서 읽어오는 유틸 */
function parseQuestionIds(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") {
    const t = v.trim();
    // JSON 배열 문자열일 수 있음
    if (t.startsWith("[") && t.endsWith("]")) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean);
      } catch {}
    }
    // CSV처럼 들어온 경우
    return t.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

export async function POST(req: Request) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);
    const isAuto = !!body?.isAuto;

    const r0 = resolveAttemptIdRaw(req, body);
    const attemptIdRaw = r0.attemptIdRaw;

    const empId =
      s(body?.empId ?? body?.emp_id) ||
      s(getCookie(req, "empId")) ||
      s(getCookie(req, "emp_id")) ||
      "";

    if (!attemptIdRaw) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { resolvedBy: r0.resolvedBy, ...(r0.detail ?? {}) } },
        { status: 400 }
      );
    }
    if (!empId) {
      return NextResponse.json({ ok: false, error: "MISSING_EMPID" }, { status: 400 });
    }

    // ✅ 여기서 answers는 비어도 됨(자동제출 허용)
    const items = normalizeAnswers(body);

    // attemptId는 start에서 숫자(bigint)로 내려오는게 정상.
    // 혹시 UUID가 들어오면 그냥 오류로(지금 구조상 필요없음)
    let attemptId: number | null = null;
    if (typeof attemptIdRaw === "number") attemptId = attemptIdRaw;
    else {
      const bs = s(attemptIdRaw);
      const asNum = n(bs, null);
      if (asNum !== null && asNum > 0) attemptId = asNum;
    }
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID_FORMAT", detail: { attemptIdRaw } }, { status: 400 });
    }

    // attempt 조회
    const { data: attempt, error: aErr } = await client
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String((aErr as any)?.message ?? aErr) }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });
    }
    // ✅ 안전: 본인 attempt만 제출 가능
    if (s(attempt.emp_id) && s(attempt.emp_id) !== empId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN_ATTEMPT", detail: { attemptEmpId: attempt.emp_id, empId } }, { status: 403 });
    }

    // ✅ “못푼 문제 = 오답” 처리를 위해 attempt의 question_ids 기준으로 채점
    const attemptQids = parseQuestionIds((attempt as any).question_ids);
    const totalQuestions = attemptQids.length || n((attempt as any).total_questions, 0) || 0;

    // 자동제출인데 question_ids도 없고, 답도 없으면 → 시작 자체가 잘못된 상태
    if (totalQuestions === 0 && items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS_IN_ATTEMPT", detail: { attemptId, note: "question_ids missing" } },
        { status: 500 }
      );
    }

    // 채점 대상 qids: attemptQids 우선, 없으면 items 기준
    const gradeQids = attemptQids.length
      ? attemptQids
      : items.map((x) => String(normalizeQid(x.questionId))).filter(Boolean);

    // questions 조회
    const normalizedForQuery = gradeQids
      .map((x) => normalizeQid(x))
      .filter((x) => x !== null) as Array<number | string>;

    const uniqueQids = Array.from(new Set(normalizedForQuery.map((x) => String(x))));
    const allNumeric = uniqueQids.every((x) => /^\d+$/.test(x));
    const qidsForQuery = allNumeric ? uniqueQids.map((x) => Number(x)) : uniqueQids;

    const { data: questions, error: qErr } = await client
      .from("questions")
      .select("*")
      .in("id", qidsForQuery as any);

    if (qErr) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((qErr as any)?.message ?? qErr) },
        { status: 500 }
      );
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String(q.id), q);

    // answers map (qid -> idx)
    const answerMap: Record<string, number> = {};
    for (const it of items) {
      const qid = normalizeQid(it.questionId);
      if (qid == null) continue;
      answerMap[String(qid)] = Number(it.selectedIndex);
    }

    // 채점
    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    const wrongQuestionIds: string[] = [];

    for (const qidStr of gradeQids) {
      const qid = normalizeQid(qidStr);
      if (qid == null) continue;

      const q = qById.get(String(qid));
      if (!q) continue;

      const points = n(q?.points, 0) ?? 0;
      totalPoints += points;

      const picked = answerMap[String(qid)];
      const correctIndex = pickCorrectIndex(q);

      const isAnswered = picked !== undefined && picked !== null && Number.isFinite(Number(picked));
      const isCorrect = isAnswered && correctIndex !== null ? Number(picked) === Number(correctIndex) : false;

      if (isCorrect) {
        correctCount += 1;
        score += points;
      } else {
        // ✅ 미응답 포함해서 오답 처리
        wrongQuestionIds.push(String(qid));
      }
    }

    const wrongCount = Math.max(0, (gradeQids.length || totalQuestions) - correctCount);

    // ✅ 답안 저장: exam_attempt_answers 테이블에 “선택한 것만” 저장(컬럼 NOT NULL 리스크 회피)
    // (미응답까지 저장하려면 selected_index가 nullable인지 확인 필요)
    const rows = Object.entries(answerMap)
      .map(([qidStr, idx]) => {
        const qid = normalizeQid(qidStr);
        if (qid == null) return null;
        return {
          attempt_id: attemptId,
          question_id: qid,
          selected_index: Number(idx),
          is_correct: (() => {
            const q = qById.get(String(qid));
            const correctIndex = pickCorrectIndex(q);
            return correctIndex !== null ? Number(idx) === Number(correctIndex) : false;
          })(),
        };
      })
      .filter(Boolean) as any[];

    // 기존 삭제 후 insert(선택한 답만)
    const { error: delErr } = await client.from("exam_attempt_answers").delete().eq("attempt_id", attemptId);
    if (delErr) {
      return NextResponse.json({ ok: false, error: "ANSWERS_DELETE_FAILED", detail: String((delErr as any)?.message ?? delErr) }, { status: 500 });
    }
    if (rows.length > 0) {
      const { error: insErr } = await client.from("exam_attempt_answers").insert(rows);
      if (insErr) {
        return NextResponse.json({ ok: false, error: "ANSWERS_INSERT_FAILED", detail: String((insErr as any)?.message ?? insErr) }, { status: 500 });
      }
    }

    // attempt 업데이트 (✅ total_questions는 전체 문항 유지!)
    const nowIso = new Date().toISOString();
    const { error: upErr } = await client
      .from("exam_attempts")
      .update({
        submitted_at: nowIso,
        status: "SUBMITTED",
        score,
        correct_count: correctCount,
        wrong_count: wrongCount,
        total_points: totalPoints,
        total_questions: gradeQids.length || totalQuestions, // ✅ rows.length 금지!
        answers: answerMap, // 선택한 답만 기록
      })
      .eq("id", attemptId);

    if (upErr) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: String((upErr as any)?.message ?? upErr) }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      attemptId,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
      wrongCount,
      savedAnswers: rows.length,
      redirectUrl: `/exam/result/${attemptId}`,
      debug: { isAuto, empId, qidsCount: gradeQids.length, qidsAllNumeric: allNumeric },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
