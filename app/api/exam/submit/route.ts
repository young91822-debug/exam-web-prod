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

/**
 * ✅ question_id / attempt_id 같은 "id"는
 * - 숫자 형태면 number로
 * - 아니면 string으로
 * DB 컬럼 타입이 bigint/int인 경우 string 넣으면 JOIN/매칭이 깨질 수 있어서 이걸로 고정.
 */
function normalizeId(v: any): number | string | null {
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

async function resolveAttemptId(
  req: Request,
  client: any,
  body: any
): Promise<{ attemptId: number | null; resolvedBy: string; detail?: any }> {
  // 0) querystring
  try {
    const u = new URL(req.url);
    const q =
      u.searchParams.get("attemptId") ||
      u.searchParams.get("attempt_id") ||
      u.searchParams.get("attemptID");
    const qNum = n(q, null);
    if (qNum && qNum > 0) return { attemptId: qNum, resolvedBy: "QUERY" };
  } catch {}

  // 1) body
  const fromBody =
    body?.attemptId ??
    body?.attempt_id ??
    body?.attemptID ??
    body?.AttemptId ??
    body?.AttemptID ??
    body?.id ??
    body?.attempt?.id;

  const bodyNum = n(fromBody, null);
  if (bodyNum && bodyNum > 0) return { attemptId: bodyNum, resolvedBy: "BODY" };

  // 2) cookie attemptId (옵션)
  const cAttempt = n(getCookie(req, "attemptId") || getCookie(req, "attempt_id"), null);
  if (cAttempt && cAttempt > 0) return { attemptId: cAttempt, resolvedBy: "COOKIE_ATTEMPTID" };

  // 3) empId 최신 STARTED
  const empId =
    s(body?.empId ?? body?.emp_id) ||
    s(getCookie(req, "empId")) ||
    s(getCookie(req, "emp_id")) ||
    "";

  if (empId) {
    const { data: a, error } = await client
      .from("exam_attempts")
      .select("id, emp_id, status, started_at")
      .eq("emp_id", empId)
      .eq("status", "STARTED")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && a?.id) {
      return { attemptId: Number(a.id), resolvedBy: "EMPID_LATEST_STARTED", detail: { empId } };
    }
  }

  return { attemptId: null, resolvedBy: "NONE", detail: { url: req.url, keys: Object.keys(body ?? {}) } };
}

export async function POST(req: Request) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);

    const r = await resolveAttemptId(req, client, body);
    const attemptId = r.attemptId;

    if (!attemptId) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { resolvedBy: r.resolvedBy, ...(r.detail ?? {}) } },
        { status: 400 }
      );
    }

    const items = normalizeAnswers(body);
    if (items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ANSWERS", detail: { resolvedBy: r.resolvedBy, attemptId } },
        { status: 400 }
      );
    }

    const { data: attempt, error: aErr } = await client
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_QUERY_FAILED", detail: String((aErr as any)?.message ?? aErr) },
        { status: 500 }
      );
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });
    }

    /**
     * ✅ questions 조회도 id 타입을 맞춰서 in() 해줘야 함
     * - 숫자면 number 배열로
     * - 문자열이면 string 배열로
     * 혼합이면 string으로 통일(안전)
     */
    const normalizedQids = items
      .map((x) => normalizeId(x.questionId))
      .filter((x) => x !== null) as Array<number | string>;

    const uniqueQids = Array.from(new Set(normalizedQids.map((x) => String(x))));
    const allNumeric = uniqueQids.every((x) => /^\d+$/.test(x));

    const qidsForQuery = allNumeric ? uniqueQids.map((x) => Number(x)) : uniqueQids;

    const { data: questions, error: qErr } = await client.from("questions").select("*").in("id", qidsForQuery);

    if (qErr) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((qErr as any)?.message ?? qErr) },
        { status: 500 }
      );
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String(q.id), q);

    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    const wrongQuestionIds: string[] = [];
    const answerMapForAttempt: Record<string, number> = {};

    const rows = items
      .map((it) => {
        const qid = normalizeId(it.questionId);
        if (qid === null) return null;

        const q = qById.get(String(qid));
        if (!q) return null;

        const points = n(q?.points, 0) ?? 0;
        totalPoints += points;

        const correctIndex = pickCorrectIndex(q);
        const isCorrect =
          correctIndex !== null ? Number(it.selectedIndex) === Number(correctIndex) : false;

        if (isCorrect) {
          correctCount += 1;
          score += points;
        } else {
          wrongQuestionIds.push(String(qid));
        }

        // ✅ attempt.answers fallback 저장용
        answerMapForAttempt[String(qid)] = Number(it.selectedIndex);

        return {
          attempt_id: attemptId,
          // ✅ 핵심: 숫자 ID는 number로 넣기 (DB bigint/int이면 이게 맞음)
          question_id: qid,
          selected_index: Number(it.selectedIndex),
          is_correct: isCorrect,
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_VALID_ROWS", detail: { attemptId, items: items.length, questions: (questions ?? []).length } },
        { status: 400 }
      );
    }

    // 재제출 대비: 기존 삭제 후 insert
    const { error: delErr } = await client
      .from("exam_attempt_answers")
      .delete()
      .eq("attempt_id", attemptId);

    if (delErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_DELETE_FAILED", detail: String((delErr as any)?.message ?? delErr) },
        { status: 500 }
      );
    }

    const { error: insErr } = await client.from("exam_attempt_answers").insert(rows);

    if (insErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_INSERT_FAILED", detail: String((insErr as any)?.message ?? insErr) },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();
    const { error: upErr } = await client
      .from("exam_attempts")
      .update({
        submitted_at: nowIso,
        status: "SUBMITTED",
        score,
        correct_count: correctCount,
        total_points: totalPoints,
        total_questions: rows.length,
        answers: answerMapForAttempt, // ✅ fallback용 저장(결과 API가 이걸 읽게 만들 수도 있음)
      })
      .eq("id", attemptId);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: String((upErr as any)?.message ?? upErr) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      attemptId,
      resolvedBy: r.resolvedBy,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
      savedAnswers: rows.length,
      marker: "SUBMIT_OK_SAVED_TO_exam_attempt_answers_AND_exam_attempts.answers",
      debug: {
        qidsAllNumeric: allNumeric,
        qidsCount: uniqueQids.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
