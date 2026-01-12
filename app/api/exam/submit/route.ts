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
 * questions.id가 bigint/int면 number가 안전
 * (여기는 문제ID 정규화용)
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
 * ✅ UUID 입력(프론트 attemptId) -> exam_attempts의 bigint id로 변환
 * 어떤 컬럼명인지 모를 때를 대비해서 "가능한 후보 컬럼"을 순서대로 조회 시도.
 *
 * - 컬럼이 없으면 supabase가 에러를 주는데, 그건 무시하고 다음 후보로 진행
 * - 하나라도 매칭되면 bigint id 반환
 */
async function resolveBigintAttemptIdFromUuid(
  client: any,
  uuid: string
): Promise<{ id: number | null; tried: string[]; matchedBy?: string; lastErr?: string }> {
  const candidates = [
    "attempt_uuid",
    "attempt_uid",
    "attemptId",
    "attempt_id",
    "uuid",
    "uid",
    "public_id",
    "public_uuid",
    "external_id",
    "session_id",
    "token",
  ];

  const tried: string[] = [];
  let lastErr: string | undefined;

  for (const col of candidates) {
    tried.push(col);
    try {
      const { data, error } = await client
        .from("exam_attempts")
        .select("id")
        .eq(col, uuid)
        .limit(1)
        .maybeSingle();

      if (error) {
        lastErr = String((error as any)?.message ?? error);
        // 컬럼 없음/타입 불일치 등 → 다음 후보
        continue;
      }
      if (data?.id != null) {
        const idNum = n(data.id, null);
        if (idNum !== null) return { id: idNum, tried, matchedBy: col };
      }
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
      continue;
    }
  }

  return { id: null, tried, lastErr };
}

/**
 * ✅ attemptId 파싱: 숫자면 그대로, UUID면 일단 문자열로 받기
 */
async function resolveAttemptId(
  req: Request,
  body: any
): Promise<{ attemptIdRaw: string | number | null; resolvedBy: string; detail?: any }> {
  // 0) querystring
  try {
    const u = new URL(req.url);
    const q =
      u.searchParams.get("attemptId") ||
      u.searchParams.get("attempt_id") ||
      u.searchParams.get("attemptID");

    if (q) {
      const qs = s(q);
      if (isUUID(qs)) return { attemptIdRaw: qs, resolvedBy: "QUERY_UUID" };
      const qNum = n(qs, null);
      if (qNum !== null && qNum > 0) return { attemptIdRaw: qNum, resolvedBy: "QUERY_NUMBER" };
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
    if (isUUID(bs)) return { attemptIdRaw: bs, resolvedBy: "BODY_UUID" };
    const bodyNum = n(bs, null);
    if (bodyNum !== null && bodyNum > 0) return { attemptIdRaw: bodyNum, resolvedBy: "BODY_NUMBER" };
  }

  // 2) cookie attemptId (옵션)
  const cAttemptRaw = getCookie(req, "attemptId") || getCookie(req, "attempt_id");
  if (cAttemptRaw) {
    const cs = s(cAttemptRaw);
    if (isUUID(cs)) return { attemptIdRaw: cs, resolvedBy: "COOKIE_UUID" };
    const cNum = n(cs, null);
    if (cNum !== null && cNum > 0) return { attemptIdRaw: cNum, resolvedBy: "COOKIE_NUMBER" };
  }

  return { attemptIdRaw: null, resolvedBy: "NONE", detail: { url: req.url, keys: Object.keys(body ?? {}) } };
}

export async function POST(req: Request) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error }, { status: 500 });
  }

  try {
    const body = await readBody(req);

    // 1) attemptId 원본(숫자 or UUID) 받기
    const r0 = await resolveAttemptId(req, body);
    const attemptIdRaw = r0.attemptIdRaw;

    if (!attemptIdRaw) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { resolvedBy: r0.resolvedBy, ...(r0.detail ?? {}) } },
        { status: 400 }
      );
    }

    // 2) ✅ DB의 exam_attempts.id(bigint)로 쓸 최종 attemptId 만들기
    let attemptId: number | null = null;
    let resolvedBy = r0.resolvedBy;
    let resolveDetail: any = {};

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

      // UUID -> bigint id 변환 시도
      const rr = await resolveBigintAttemptIdFromUuid(client, uuid);
      if (!rr.id) {
        return NextResponse.json(
          {
            ok: false,
            error: "ATTEMPT_ID_UUID_NOT_MAPPED",
            detail: {
              attempt_uuid: uuid,
              resolvedBy,
              triedColumns: rr.tried,
              lastErr: rr.lastErr,
            },
          },
          { status: 400 }
        );
      }

      attemptId = rr.id;
      resolvedBy = `${resolvedBy}=>MAPPED_UUID_TO_BIGINT(${rr.matchedBy})`;
      resolveDetail = { mappedFromUuid: uuid, matchedBy: rr.matchedBy, triedColumns: rr.tried };
    }

    // 3) answers 파싱
    const items = normalizeAnswers(body);
    if (items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "NO_ANSWERS", detail: { resolvedBy, attemptId, ...resolveDetail } },
        { status: 400 }
      );
    }

    // 4) attempt 조회 (✅ bigint id만 사용)
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

    // 5) questions 조회
    const normalizedQids = items
      .map((x) => normalizeId(x.questionId))
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
          attempt_id: attemptId, // ✅ bigint only
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
          detail: { attemptId, resolvedBy, items: items.length, questions: (questions ?? []).length, ...resolveDetail },
        },
        { status: 400 }
      );
    }

    // 6) 기존 삭제 후 insert
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

    // 7) attempt 업데이트
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
      attemptId, // ✅ bigint id
      resolvedBy,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
      savedAnswers: rows.length,
      marker: "SUBMIT_OK_UUID_MAPPED_TO_BIGINT_OR_DIRECT_BIGINT",
      debug: {
        qidsAllNumeric: allNumeric,
        qidsCount: uniqueQids.length,
        ...resolveDetail,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
