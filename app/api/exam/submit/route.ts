// app/api/exam/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
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
function isNumericId(x: any) {
  return /^\d+$/.test(s(x));
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
    q?.answer,
  ];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function looksMissingColumn(err: any, col: string) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes(col) && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("Could not find"));
}

export async function POST(req: NextRequest) {
  const { client, error } = getSupabaseAdmin();
  if (error) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_ADMIN_INIT_FAILED", detail: error },
      { status: 500 }
    );
  }

  try {
    const body = await readBody(req);
    const isAuto = !!body?.isAuto;

    // ✅ 쿠키에서 empId/team도 읽어둠(팀 저장용)
    const empIdCookie = s(req.cookies.get("empId")?.value);
    const teamCookie = s(req.cookies.get("team")?.value);

    // ✅ attemptId (숫자)
    const attemptIdRaw = body?.attemptId ?? body?.attempt_id ?? body?.id ?? null;
    if (!isNumericId(attemptIdRaw)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ATTEMPT_ID", detail: { attemptIdRaw } },
        { status: 400 }
      );
    }
    const attemptId = Number(attemptIdRaw);

    // ✅ answers: { [questionId]: selectedIndex }
    const answersObj =
      body?.answers ??
      body?.answerMap ??
      body?.selected ??
      body?.items ??
      {};

    const answersMap: Record<string, number> = {};
    if (answersObj && typeof answersObj === "object" && !Array.isArray(answersObj)) {
      for (const [k, v] of Object.entries(answersObj)) {
        const qid = s(k);
        const idx = n(v, null);
        if (!qid) continue;
        if (idx === null) continue;
        answersMap[qid] = Number(idx);
      }
    }

    // ✅ 수동 제출인데 답이 0개면 막기 (자동제출은 허용)
    if (!isAuto && Object.keys(answersMap).length === 0) {
      return NextResponse.json({ ok: false, error: "NO_ANSWERS" }, { status: 400 });
    }

    // 1) attempt 가져오기
    const { data: attempt, error: aErr } = await client
      .from("exam_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();

    if (aErr) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_QUERY_FAILED", detail: aErr }, { status: 500 });
    }
    if (!attempt) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND", detail: { attemptId } }, { status: 404 });
    }

    // ✅ team 결정: attempt.team > 쿠키 team > (admin_gs면 B) > A
    const team =
      s((attempt as any)?.team) ||
      teamCookie ||
      (empIdCookie === "admin_gs" ? "B" : "A");

    // 2) 문제 id 목록: exam_attempts.question_ids 를 1순위로 사용
    const questionIds: string[] = Array.isArray((attempt as any)?.question_ids)
      ? (attempt as any).question_ids.map((x: any) => s(x)).filter(Boolean)
      : [];

    const uniqQids = Array.from(new Set(questionIds)).filter(Boolean);

    // 3) questions 조회 (없어도 제출은 되게)
    const { data: questions, error: qErr } = uniqQids.length
      ? await client.from("questions").select("*").in("id", uniqQids as any)
      : { data: [], error: null as any };

    if (qErr) {
      return NextResponse.json({ ok: false, error: "QUESTIONS_QUERY_FAILED", detail: qErr }, { status: 500 });
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(String((q as any).id), q);

    // 4) 채점
    let totalPoints = 0;
    let score = 0;
    let correctCount = 0;
    let wrongCount = 0;
    const wrongQuestionIds: string[] = [];

    // ✅ exam_answers에 넣을 rows (선택한 것만 저장)
    const rowsToInsert: any[] = [];

    for (const qid of uniqQids) {
      const q = qById.get(String(qid));
      const pts = n(q?.points, 0) ?? 0;
      totalPoints += pts;

      const selectedIndex = Object.prototype.hasOwnProperty.call(answersMap, qid)
        ? Number(answersMap[qid])
        : null;

      const correctIndex = pickCorrectIndex(q);

      if (selectedIndex === null || selectedIndex === undefined) {
        wrongCount += 1;
        wrongQuestionIds.push(String(qid));
        continue;
      }

      const isCorrect =
        correctIndex !== null && Number.isFinite(Number(correctIndex))
          ? Number(selectedIndex) === Number(correctIndex)
          : false;

      if (isCorrect) {
        correctCount += 1;
        score += pts;
      } else {
        wrongCount += 1;
        wrongQuestionIds.push(String(qid));
      }

      rowsToInsert.push({
        attempt_id: attemptId,
        question_id: qid,
        selected_index: Number(selectedIndex),
      });
    }

    // 5) 기존 답안 삭제 후 재저장
    const { error: delErr } = await client
      .from("exam_answers")
      .delete()
      .eq("attempt_id", attemptId);

    if (delErr) {
      return NextResponse.json({ ok: false, error: "ANSWERS_DELETE_FAILED", detail: delErr }, { status: 500 });
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await client
        .from("exam_answers")
        .insert(rowsToInsert);

      if (insErr) {
        return NextResponse.json({ ok: false, error: "ANSWERS_INSERT_FAILED", detail: insErr }, { status: 500 });
      }
    }

    // ✅ 6) attempt 업데이트: 가능한 컬럼은 다 저장 시도 → 없으면 fallback
    const nowIso = new Date().toISOString();

    const fullUpdate: any = {
      submitted_at: nowIso,
      status: "SUBMITTED",
      score,
      total_points: totalPoints,
      correct_count: correctCount,
      wrong_count: wrongCount,
      // answers 컬럼이 있으면(있을 가능성 높음) 같이 저장
      answers: answersMap,
      team,
    };

    const r1 = await client
      .from("exam_attempts")
      .update(fullUpdate)
      .eq("id", attemptId);

    if (r1.error) {
      // 컬럼 없어서 실패할 수 있으니 단계적으로 줄여서 재시도
      const cols = ["score", "total_points", "correct_count", "wrong_count", "answers", "team"];
      let patch: any = { submitted_at: nowIso, status: "SUBMITTED" };

      // 하나씩 추가 시도
      for (const col of cols) {
        const nextPatch = { ...patch, [col]: fullUpdate[col] };
        const r = await client.from("exam_attempts").update(nextPatch).eq("id", attemptId);
        if (!r.error) {
          patch = nextPatch;
          continue;
        }
        // 해당 컬럼이 없으면 무시하고 다음
        if (looksMissingColumn(r.error, col)) continue;

        // 다른 DB 에러면 바로 반환
        return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: r.error }, { status: 500 });
      }

      // 최소 업데이트는 반드시 성공해야 함
      const rMin = await client
        .from("exam_attempts")
        .update({ submitted_at: nowIso, status: "SUBMITTED" })
        .eq("id", attemptId);

      if (rMin.error) {
        return NextResponse.json({ ok: false, error: "ATTEMPT_UPDATE_FAILED", detail: rMin.error }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        attemptId,
        score,
        totalPoints,
        correctCount,
        wrongQuestionIds,
        savedAnswers: rowsToInsert.length,
        isAuto,
        redirectUrl: `/exam/result/${attemptId}`,
        note: "attempt updated with fallback (some columns may not exist)",
      });
    }

    return NextResponse.json({
      ok: true,
      attemptId,
      score,
      totalPoints,
      correctCount,
      wrongQuestionIds,
      savedAnswers: rowsToInsert.length,
      isAuto,
      redirectUrl: `/exam/result/${attemptId}`,
      note: "attempt updated with score/count/team/answers when available",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SUBMIT_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
