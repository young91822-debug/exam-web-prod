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

/**
 * ✅ question_id 같은 "id"는
 * - 숫자 형태면 number로
 * - 아니면 string으로
 * (questions.id가 bigint/int면 number가 안전)
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

/**
 * ✅ 핵심 수정:
 * attemptId는 숫자/UUID 둘 다 허용해야 함 (지금 시험 화면 attemptId가 UUID임)
 */
async function resolveAttemptId(
  req: Request,
  client: any,
  body: any
): Promise<{ attemptId: string | number | null; resolvedBy: string; detail?: any }> {
  // 0) querystring
  try {
    const u = new URL(req.url);
    const q =
      u.searchParams.get("attemptId") ||
      u.searchParams.get("attempt_id") ||
      u.searchParams.get("attemptID");

    if (q) {
      const qs = s(q);
      if (isUUID(qs)) return { attemptId: qs, resolvedBy: "QUERY_UUID" };
      const qNum = n(qs, null);
      if (qNum !== null && qNum > 0) return { attemptId: qNum, resolvedBy: "QUERY_NUMBER" };
    }
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

  if (fromBody !== undefined && fromBody !== null && fromBody !== "") {
    const bs = s(fromBody);
    if (isUUID(bs)) return { attemptId: bs, resolvedBy: "BODY_UUID" };
    const bodyNum = n(bs, null);
    if (bodyNum !== null && bodyNum > 0) return { attemptId: bodyNum, resolvedBy: "BODY_NUMBER" };
  }

  // 2) cookie attemptId (옵션)
  const cAttemptRaw = getCookie(req, "attemptId") || getCookie(req, "attempt_id");
  if (cAttemptRaw) {
    const cs = s(cAttemptRaw);
    if (isUUID(cs)) return { attemptId: cs, resolvedBy: "COOKIE_UUID" };
    const cNum = n(cs, null);
    if (cNum !== null && cNum > 0) return { attemptId: cNum, resolvedBy: "COOKIE_NUMBER" };
  }

  // 3) empId 최신 STARTED (⚠️ id가 UUID일 수도 있으니 Number() 절대 금지)
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
      // id가 UUID면 그대로 string, 숫자면 number
      const aid = String(a.id);
      if (isUUID(aid)) return { attemptId: aid, resolvedBy: "EMPID_LATEST_STARTED_UUID", detail: { empId } };
      const aidNum = n(aid, null);
      if (aidNum !== null && aidNum > 0) return { attemptId: aidNum, resolvedBy: "EMPID_LATEST_STARTED_NUMBER", detail: { empId } };

      // 혹시 예외 타입이면 그냥 string으로라도 넘김
      return { attemptId: aid, resolvedBy: "EMPID_LATEST_STARTED_FALLBACK", detail: { empId } };
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

    // ✅ UUID/number 둘 다 그대로 eq("id", attemptId) 가능 (Supabase가 처리)
    const { data: attempt, error: aErr } = await client
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId as any)
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

    // questions 조회 (id 타입 맞춤)
    const normalizedQids = items
      .map((x) => normalizeId(x.questionId))
      .filter((x) => x !== null) as Array<number | string>;

    const uniqueQids = Array.from(new Set(normalizedQids.map((x) => String(x))));
    const allNumeric = uniqueQids.every((x) => /^\d+$/.test(x));
    const qidsForQuery = allNumeric ? uniqueQids.map((x) => Number(x)) : uniqueQids;

    const { data: questions, error: qErr } = await client.from("questions").select("*").in("id", qidsForQuery as any);

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
        const isCorrect = correctIndex !== null ? Number(it.selectedIndex) === Number(correctIndex) : false;

        if (isCorrect) {
          correctCount += 1;
          score += points;
        } else {
          wrongQuestionIds.push(String(qid));
        }

        answerMapForAttempt[String(qid)] = Number(it.selectedIndex);

        return {
          attempt_id: attemptId as any, // ✅ UUID든 number든 그대로 저장
          question_id: qid,
          selected_index: Number(it.selectedIndex),
          is_correct: isCorrect,
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_VALID_ROWS",
          detail: { attemptId, items: items.length, questions: (questions ?? []).length },
        },
        { status: 400 }
      );
    }

    // 재제출 대비: 기존 삭제 후 insert
    const { error: delErr } = await client
      .from("exam_attempt_answers")
      .delete()
      .eq("attempt_id", attemptId as any);

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
        answers: answerMapForAttempt,
      })
      .eq("id", attemptId as any);

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
      marker: "SUBMIT_OK_UUID_OR_NUMBER_ATTEMPT",
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
