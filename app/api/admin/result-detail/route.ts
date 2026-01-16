// app/api/admin/result-detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

function isMissingColumn(err: any, col?: string) {
  const msg = String(err?.message ?? err ?? "");
  const low = msg.toLowerCase();
  if (!col) {
    return low.includes("does not exist") || low.includes("could not find") || low.includes("schema cache");
  }
  return (
    (low.includes("does not exist") && low.includes(col.toLowerCase())) ||
    msg.includes(`Could not find the '${col}' column`)
  );
}

/**
 * ✅ 관리자 권한 가드 (현실버전)
 * - owner_admin 있으면: owner_admin === adminEmpId 만 허용
 * - owner_admin 없고 adminTeam 쿠키 있으면:
 *    - attempt.team이 있으면 team 일치만 허용
 *    - ✅ attempt.team이 없으면(컬럼없음/NULL): 팀가드 불가 -> 통과(=상세 조회 가능)
 * - adminTeam 쿠키 없으면: 슈퍼관리자로 보고 통과
 */
function authorizeAdminForAttempt(adminEmpId: string, attempt: any, adminTeam: string | null) {
  const attemptTeam = s(attempt?.team).toUpperCase(); // A/B or ""
  const owner = s(attempt?.owner_admin);

  // 1) owner_admin 있으면 최우선
  if (owner) return owner === adminEmpId;

  // 2) adminTeam 쿠키 있으면 team 기준으로 가드(가능할 때만)
  if (adminTeam) {
    // ✅ attempt에 team이 없으면(컬럼/데이터가 없어서) 가드 불가 -> 통과
    if (!attemptTeam) return true;
    return attemptTeam === s(adminTeam).toUpperCase();
  }

  // 3) adminTeam 없으면 슈퍼관리자(전체 허용)
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

/** attempt.answers에서 map/ids 추출 */
function parseAttemptAnswers(attempt: any): { map: Record<string, number>; questionIds: string[] } {
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
    if (k && idx !== null) map[String(k).trim()] = idx;
  }

  const qidsRaw = a?.questionIds ?? a?.question_ids ?? a?.questions ?? null;

  let questionIds: string[] = [];
  if (Array.isArray(qidsRaw)) {
    questionIds = qidsRaw
      .map((x: any) => s(typeof x === "object" ? x?.id ?? x?.question_id ?? x?.qid : x))
      .filter(Boolean);
  } else if (typeof qidsRaw === "string") {
    questionIds = qidsRaw.split(",").map((x) => s(x)).filter(Boolean);
  }

  questionIds = Array.from(new Set(questionIds));
  return { map, questionIds };
}

/** legacy(exam_attempts)에서 graded 만들기 */
async function buildLegacyDetailFromExamAttempts(attempt: any) {
  let questionIds: string[] = Array.isArray(attempt?.question_ids)
    ? attempt.question_ids.map((x: any) => s(x)).filter(Boolean)
    : [];

  const parsed = parseAttemptAnswers(attempt);

  if (questionIds.length === 0) questionIds = parsed.questionIds;
  if (questionIds.length === 0) questionIds = Object.keys(parsed.map || {}).map((k) => s(k)).filter(Boolean);

  const selectedByQid = new Map<string, number>();
  for (const [qid, idx] of Object.entries(parsed.map)) selectedByQid.set(String(qid).trim(), Number(idx));

  const { data: questions, error: qErr } = await supabaseAdmin
    .from("questions")
    .select("*")
    .in("id", questionIds.length ? questionIds : ["__never__"]);

  if (qErr) return { ok: false as const, error: "QUESTIONS_QUERY_FAILED", detail: qErr };

  const qById = new Map<string, any>();
  for (const q of questions ?? []) qById.set(String((q as any).id), q);

  const graded = questionIds.map((qid) => {
    const q = qById.get(String(qid)) ?? {};
    const key = String(qid).trim();
    const selectedIndex = selectedByQid.has(key) ? selectedByQid.get(key)! : null;
    const correctIndex = pickCorrectIndex(q);

    const status = selectedIndex == null ? "unsubmitted" : "submitted";
    const isCorrect =
      status === "submitted" && correctIndex != null ? Number(selectedIndex) === Number(correctIndex) : false;

    return {
      questionId: q?.id ?? qid,
      content: q?.content ?? "",
      choices: pickChoices(q),
      selectedIndex,
      correctIndex,
      status,
      isCorrect,
    };
  });

  return {
    ok: true as const,
    attempt,
    graded,
    meta: {
      idType: "num",
      source: "exam_attempts",
      attemptId: attempt?.id,
      questionIdsCount: questionIds.length,
      mapKeysCount: Object.keys(parsed.map).length,
    },
  };
}

/** UUID attempt를 legacy(exam_attempts)로 매칭: started_at 기준(±2분) */
async function resolveLegacyByStartedAt(attemptUuidRow: any) {
  const startedAt = attemptUuidRow?.started_at ?? attemptUuidRow?.startedAt ?? null;
  if (!startedAt) return { ok: false as const, error: "UUID_ATTEMPT_NO_STARTED_AT" };

  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime()))
    return { ok: false as const, error: "UUID_ATTEMPT_BAD_STARTED_AT", detail: startedAt };

  const t0 = new Date(d.getTime() - 2 * 60 * 1000).toISOString();
  const t1 = new Date(d.getTime() + 2 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from("exam_attempts")
    .select("*")
    .gte("started_at", t0)
    .lte("started_at", t1)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);

  if (error) return { ok: false as const, error: "LEGACY_MATCH_QUERY_FAILED", detail: error };
  if (!rows || rows.length === 0) return { ok: false as const, error: "LEGACY_MATCH_NOT_FOUND", detail: { t0, t1 } };

  const best =
    rows.find((r: any) => !!r?.emp_id) ??
    rows.find((r: any) => r?.score != null) ??
    rows[0];

  return { ok: true as const, attempt: best, candidates: rows.map((r: any) => r?.id) };
}

export async function GET(req: Request) {
  try {
    const adminEmpId = s(getCookie(req, "empId"));
    const role = s(getCookie(req, "role"));
    const adminTeam = s(getCookie(req, "team")) || null;

    if (!adminEmpId || role !== "admin") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const u = new URL(req.url);
    const raw =
      getParamCI(u, "attemptId", "attempt_id", "attemptID", "attemptid", "id", "AttemptId", "AttemptID") ?? "";
    const attemptKey = s(raw);

    if (!attemptKey) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { url: req.url, got: raw } },
        { status: 400 }
      );
    }

    // =========================
    // 1) UUID attempt
    // =========================
    if (isUuid(attemptKey)) {
      const { data: uuidAttempt, error: aErr } = await supabaseAdmin
        .from("attempts")
        .select("*")
        .eq("id", attemptKey)
        .maybeSingle();

      if (aErr) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
      if (!uuidAttempt)
        return NextResponse.json(
          { ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId: attemptKey, source: "attempts" } },
          { status: 404 }
        );

      const resolved = await resolveLegacyByStartedAt(uuidAttempt);
      if (!resolved.ok) {
        return NextResponse.json({ ok: false, error: "LEGACY_MATCH_FAILED", detail: resolved }, { status: 404 });
      }

      if (!authorizeAdminForAttempt(adminEmpId, resolved.attempt, adminTeam)) {
        return NextResponse.json(
          {
            ok: false,
            error: "FORBIDDEN",
            debug: { adminEmpId, adminTeam, attemptTeam: s(resolved.attempt?.team), owner_admin: s(resolved.attempt?.owner_admin) },
          },
          { status: 403 }
        );
      }

      const legacyDetail = await buildLegacyDetailFromExamAttempts(resolved.attempt);
      if (!legacyDetail.ok) {
        return NextResponse.json({ ok: false, error: legacyDetail.error, detail: legacyDetail.detail }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        attempt: legacyDetail.attempt,
        graded: legacyDetail.graded,
        meta: {
          ...legacyDetail.meta,
          idType: "uuid->num",
          source: "attempts + exam_attempts",
          originalUuid: attemptKey,
          matchedBy: "started_at_window_±2m",
          legacyCandidates: resolved.candidates,
        },
      });
    }

    // =========================
    // 2) Numeric attempt (legacy)
    // =========================
    if (!isNumericId(attemptKey)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID", detail: { got: attemptKey } }, { status: 400 });
    }

    const attemptId = n(attemptKey, null);
    if (!attemptId || attemptId <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID", detail: { got: attemptKey } }, { status: 400 });
    }

    let attempt: any = null;

    // owner_admin 있으면 강제 필터 시도
    let r1 = await supabaseAdmin
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .eq("owner_admin", adminEmpId)
      .maybeSingle();

    // owner_admin 컬럼이 없으면 fallback
    if (r1.error && isMissingColumn(r1.error, "owner_admin")) {
      r1 = await supabaseAdmin.from("exam_attempts").select("*").eq("id", attemptId).maybeSingle();
    }

    if (r1.error) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: r1.error }, { status: 500 });

    attempt = r1.data;

    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });
    }

    if (!authorizeAdminForAttempt(adminEmpId, attempt, adminTeam)) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          debug: { adminEmpId, adminTeam, attemptTeam: s(attempt?.team), owner_admin: s(attempt?.owner_admin) },
        },
        { status: 403 }
      );
    }

    const legacyDetail = await buildLegacyDetailFromExamAttempts(attempt);
    if (!legacyDetail.ok) {
      return NextResponse.json({ ok: false, error: legacyDetail.error, detail: legacyDetail.detail }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      attempt: legacyDetail.attempt,
      graded: legacyDetail.graded,
      meta: legacyDetail.meta,
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
