// app/api/admin/result-detail/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
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

function upperTeam(v: any) {
  const t = s(v).toUpperCase();
  return t === "B" ? "B" : "A";
}

function authorizeAdminForAttempt(adminEmpId: string, adminTeam: "A" | "B", attempt: any) {
  const owner = s(attempt?.owner_admin);
  if (owner) return owner === adminEmpId;

  const attemptTeamRaw = s(attempt?.team);
  if (attemptTeamRaw) return upperTeam(attemptTeamRaw) === adminTeam;

  // 레거시(team null)는 안전하게 허용(이걸 막고 싶으면 false로 바꾸면 됨)
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

function parseAttemptAnswersMap(attempt: any): Record<string, number> {
  let a: any = attempt?.answers;
  if (typeof a === "string") {
    try { a = JSON.parse(a); } catch { a = null; }
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
  return map;
}

/** ✅ 핵심: exam_answers에서 답안 읽기 */
async function readAnswersFromExamAnswers(attemptId: number) {
  const { data, error } = await supabaseAdmin
    .from("exam_answers")
    .select("question_id, selected_index")
    .eq("attempt_id", attemptId);

  if (error) return { ok: false as const, error };
  const map: Record<string, number> = {};
  for (const r of data ?? []) {
    const qid = s((r as any).question_id);
    const idx = n((r as any).selected_index, null);
    if (!qid || idx === null) continue;
    map[qid] = Number(idx);
  }
  return { ok: true as const, map, count: Object.keys(map).length };
}

async function buildDetail(attempt: any) {
  // question_ids
  let questionIds: string[] = Array.isArray(attempt?.question_ids)
    ? attempt.question_ids.map((x: any) => s(x)).filter(Boolean)
    : [];

  // ✅ 1순위: exam_answers에서 답안 읽기
  const attemptIdNum = n(attempt?.id, null);
  let selectedMap: Record<string, number> = {};
  let answerSource: "exam_answers" | "attempt.answers" = "attempt.answers";
  let examAnswersCount = 0;

  if (attemptIdNum) {
    const r = await readAnswersFromExamAnswers(attemptIdNum);
    if (r.ok && r.count > 0) {
      selectedMap = r.map;
      examAnswersCount = r.count;
      answerSource = "exam_answers";
    }
  }

  // ✅ 2순위 fallback: exam_attempts.answers(map)
  if (Object.keys(selectedMap).length === 0) {
    selectedMap = parseAttemptAnswersMap(attempt);
  }

  if (questionIds.length === 0) questionIds = Object.keys(selectedMap);

  questionIds = Array.from(new Set(questionIds)).filter(Boolean);

  const { data: questions, error: qErr } = await supabaseAdmin
    .from("questions")
    .select("*")
    .in("id", questionIds.length ? (questionIds as any) : ["__never__"]);

  if (qErr) {
    return { ok: false as const, error: "QUESTIONS_QUERY_FAILED", detail: qErr };
  }

  const qById = new Map<string, any>();
  for (const q of questions ?? []) qById.set(String((q as any).id), q);

  const graded = questionIds.map((qid) => {
    const q = qById.get(String(qid)) ?? {};
    const key = String(qid).trim();

    const selectedIndex = Object.prototype.hasOwnProperty.call(selectedMap, key) ? Number(selectedMap[key]) : null;
    const correctIndex = pickCorrectIndex(q);

    const status = selectedIndex == null ? "unsubmitted" : "submitted";
    const isCorrect = status === "submitted" && correctIndex != null
      ? Number(selectedIndex) === Number(correctIndex)
      : false;

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
      source: "exam_attempts + questions",
      answersSource: answerSource,
      examAnswersCount,
      questionIdsCount: questionIds.length,
      mapKeysCount: Object.keys(selectedMap).length,
    },
  };
}

async function resolveLegacyByStartedAt(attemptUuidRow: any) {
  const startedAt = attemptUuidRow?.started_at ?? attemptUuidRow?.startedAt ?? null;
  if (!startedAt) return { ok: false as const, error: "UUID_ATTEMPT_NO_STARTED_AT" };

  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return { ok: false as const, error: "UUID_ATTEMPT_BAD_STARTED_AT", detail: startedAt };

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

  const best = rows.find((r: any) => !!r?.emp_id) ?? rows[0];
  return { ok: true as const, attempt: best, candidates: rows.map((r: any) => r?.id) };
}

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
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { url: req.url, got: raw, allParams: Array.from(u.searchParams.entries()) } },
        { status: 400 }
      );
    }

    // 1) UUID attempt -> attempts 테이블 -> exam_attempts 매칭
    if (isUuid(attemptKey)) {
      const { data: uuidAttempt, error: aErr } = await supabaseAdmin
        .from("attempts")
        .select("*")
        .eq("id", attemptKey)
        .maybeSingle();

      if (aErr) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
      if (!uuidAttempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });

      const resolved = await resolveLegacyByStartedAt(uuidAttempt);
      if (!resolved.ok) return NextResponse.json({ ok: false, error: "LEGACY_MATCH_FAILED", detail: resolved }, { status: 404 });

      if (!authorizeAdminForAttempt(adminEmpId, adminTeam, resolved.attempt)) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }

      const d = await buildDetail(resolved.attempt);
      if (!d.ok) return NextResponse.json({ ok: false, error: d.error, detail: d.detail }, { status: 500 });

      return NextResponse.json({
        ok: true,
        attempt: d.attempt,
        graded: d.graded,
        meta: { ...d.meta, idType: "uuid->num", originalUuid: attemptKey, adminTeam, legacyCandidates: resolved.candidates },
      });
    }

    // 2) numeric attempt
    if (!isNumericId(attemptKey)) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    const attemptId = n(attemptKey, null);
    if (!attemptId || attemptId <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    const r = await supabaseAdmin.from("exam_attempts").select("*").eq("id", attemptId).maybeSingle();
    if (r.error) return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: r.error }, { status: 500 });

    const attempt = r.data;
    if (!attempt) return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });

    if (!authorizeAdminForAttempt(adminEmpId, adminTeam, attempt)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", detail: { adminTeam } }, { status: 403 });
    }

    const d = await buildDetail(attempt);
    if (!d.ok) return NextResponse.json({ ok: false, error: d.error, detail: d.detail }, { status: 500 });

    return NextResponse.json({ ok: true, attempt: d.attempt, graded: d.graded, meta: { ...d.meta, adminTeam } });
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
