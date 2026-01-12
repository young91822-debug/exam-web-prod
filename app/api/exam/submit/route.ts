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

/** questions.id 정규화 */
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

/** attemptId 원본 받기 (숫자 or UUID) */
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

/**
 * ✅ UUID가 와도 제출되게:
 * - empId의 미제출 attempt를 pick
 * - 없으면 새 attempt INSERT (여기서 total_questions NOT NULL 반드시 채움)
 */
async function getOrCreateAttemptIdByEmpId(
  client: any,
  empId: string,
  totalQuestions: number,
  totalPointsGuess: number
) {
  // 1) 미제출 attempt pick
  const { data: picked, error: pickErr } = await client
    .from("exam_attempts")
    .select("id, emp_id, status, started_at, submitted_at")
    .eq("emp_id", empId)
    .is("submitted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pickErr && picked?.id != null) {
    const idNum = n(picked.id, null);
    if (idNum !== null) return { attemptId: idNum, mode: "PICKED", picked };
  }

  // 2) 없으면 생성 (✅ total_questions NOT NULL 해결)
  const nowIso = new Date().toISOString();

  const insertRow: any = {
    emp_id: empId,
    status: "STARTED",
    started_at: nowIso,
    total_questions: totalQuestions,   // ✅ NOT NULL
    total_points: totalPointsGuess,    // (있으면 좋음)
    score: 0,                          // (NOT NULL일 수도 있어서 안전)
    correct_count: 0,                  // (NOT NULL일 수도 있어서 안전)
  };

  const { data: created, error: insErr } = await client
    .from("exam_attempts")
    .insert(insertRow)
    .select("id, emp_id, status, started_at, submitted_at")
    .maybeSingle();

  if (insErr) {
    return {
      attemptId: null as number | null,
      mode: "CREATE_FAILED",
      error: String((insErr as any)?.message ?? insErr),
      sent: { ...insertRow, answers: undefined },
    };
  }

  const createdId = n(created?.id, null);
  if (createdId === null) {
    return { attemptId: null as number | null, mode: "CREATE_FAILED", error: "CREATED_ID_NOT_NUMERIC", created };
  }

  return { attemptId: createdId, mode: "CREATED", created };
}

export async function POST(req: Request) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);

    const items = normalizeAnswers(body);
    if (items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ANSWERS", detail: { keys: Object.keys(body ?? {}) } },
        { status: 400 }
      );
    }

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
      return NextResponse.json(
        { ok: false, error: "MISSING_EMPID", detail: { note: "empId cookie/body required for UUID fallback" } },
        { status: 400 }
      );
    }

    // 先 questions 조회해서 totalPointsGuess 계산 (attempt 생성 시 total_points 넣기 위해)
    const normalizedQids = items
      .map((x) => normalizeQid(x.questionId))
      .filter((x) => x !== null) as Array<number | string>;

    const uniqueQids = Array.from(new Set(normalizedQids.map((x) => String(x))));
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

    // totalPointsGuess
    let totalPointsGuess = 0;
    for (const it of items) {
      const qid = normalizeQid(it.questionId);
      const q = qById.get(String(qid));
      const pts = n(q?.points, 0) ?? 0;
      totalPointsGuess += pts;
    }

    // ✅ 최종 attemptId(bigint)
    let attemptId: number | null = null;
    let resolvedBy = r0.resolvedBy;
    const resolveDetail: any = { empId };

    if (typeof attemptIdRaw === "number") {
      attemptId = attemptIdRaw;
    } else {
      const uuid = s(attemptIdRaw);
      if (!isUUID(uuid)) {
        return NextResponse.json(
          { ok: false, error: "INVALID_ATTEMPT_ID_FORMAT", detail: { attemptIdRaw, resolvedBy } },
          { status: 400 }
        );
      }

      const oc = await getOrCreateAttemptIdByEmpId(client, empId, items.length, totalPointsGuess);
      if (!oc.attemptId) {
        return NextResponse.json(
          {
            ok: false,
            error: "ATTEMPT_CREATE_OR_PICK_FAILED",
            detail: { empId, clientAttemptUuid: uuid, resolvedBy, ...oc },
          },
          { status: 500 }
        );
      }

      attemptId = oc.attemptId;
      resolvedBy = `${resolvedBy}=>${oc.mode}_BY_EMPID`;
      resolveDetail.clientAttemptUuid = uuid;
      resolveDetail.pickCreate = oc;
    }

    // attempt 조회
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
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId, resolvedBy, ...resolveDetail } },
        { status: 404 }
      );
    }

    // 채점/rows 생성
    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    const wrongQuestionIds: string[] = [];
    const answerMapForAttempt: Record<string, number> = {};

    const rows = items
      .map((it) => {
        const qid = normalizeQid(it.questionId);
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
          attempt_id: attemptId,
          question_id: qid,
          selected_index: Number(it.selectedIndex),
          is_correct: isCorrect,
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_VALID_ROWS", detail: { attemptId, resolvedBy, items: items.length, questions: (questions ?? []).length, ...resolveDetail } },
        { status: 400 }
      );
    }

    // 기존 삭제 후 insert
    const { error: delErr } = await client.from("exam_attempt_answers").delete().eq("attempt_id", attemptId);
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
      resolvedBy,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
      savedAnswers: rows.length,
      marker: "SUBMIT_PATCH_2026-01-12_v3_CREATE_ATTEMPT",
      redirectUrl: `/exam/result/${attemptId}`,
      debug: { ...resolveDetail, qidsAllNumeric: allNumeric, qidsCount: uniqueQids.length },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
