// app/api/exam/start/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function num(v: any, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

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

const QUESTION_TABLE = "questions";
const ATTEMPT_TABLES = ["attempts", "exam_attempts"];

async function insertAttemptSmart(client: any, userId: string) {
  // 네 attempts row에서 user_id 먹히는 거 확인됨
  const payloadCandidates = [{ user_id: userId }, {}];

  let lastErr: any = null;

  for (const table of ATTEMPT_TABLES) {
    for (const payload of payloadCandidates) {
      const { data, error } = await client.from(table).insert(payload).select("*").single();
      if (!error && data) return { tableUsed: table, attempt: data, payloadUsed: payload };
      lastErr = { tableTried: table, payloadTried: payload, error };
    }
  }

  throw lastErr;
}

export async function POST() {
  try {
    const { client, error: envErr } = getSupabaseAdmin();
    if (envErr) {
      return NextResponse.json({ ok: false, error: "ENV_ERROR", detail: envErr }, { status: 500 });
    }

    const userId = "anonymous";
    const nowIso = new Date().toISOString();

    // 1) questions 조회 (is_active 있으면 true만, 없으면 전체)
    let qrows: any[] = [];
    {
      const r1 = await client
        .from(QUESTION_TABLE)
        .select("id, content, choices, points, is_active")
        .eq("is_active", true)
        .limit(5000);

      if (!r1.error) qrows = r1.data || [];
      else {
        const r2 = await client.from(QUESTION_TABLE).select("id, content, choices, points").limit(5000);
        if (r2.error) {
          return NextResponse.json(
            { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: r2.error },
            { status: 500 }
          );
        }
        qrows = r2.data || [];
      }
    }

    if (!qrows.length) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS", detail: "questions returned 0 rows" },
        { status: 500 }
      );
    }

    // 2) 랜덤 20문제
    const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
    const pickedIds = picked.map((q) => String(q.id));
    const totalPoints = picked.reduce((sum, q) => sum + num(q.points, 5), 0);

    // 3) attempt 생성
    let attemptInfo: any;
    try {
      attemptInfo = await insertAttemptSmart(client, userId);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: e?.error ?? e },
        { status: 500 }
      );
    }

    const attemptId = String(attemptInfo?.attempt?.id ?? "");
    if (!attemptId) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_ID_MISSING", detail: { attemptInfo } },
        { status: 500 }
      );
    }

    // ✅ 4) 매핑 테이블이 없으니 attempts row 자체에 questions/설정 저장
    // (네 row에 questions/answers/wrongs/duration_sec/started_at/total_points 컬럼 있는 거 확인됨)
    const patch: any = {
      started_at: nowIso,
      duration_sec: 900, // 15분
      total_points: totalPoints,
      questions: pickedIds, // ✅ 핵심: attempt에 문제 UUID 배열 저장
      answers: [],          // 초기화
      wrongs: [],           // 초기화
      submitted_at: null,
      score: 0,
    };

    const { error: upErr } = await client.from(attemptInfo.tableUsed).update(patch).eq("id", attemptId);
    if (upErr) {
      // 그래도 프론트는 문제 풀게 해주고, 디버그로만 남김
      return NextResponse.json(
        {
          ok: true,
          attemptId,
          questions: picked.map((q) => ({
            id: String(q.id),
            content: String(q.content ?? ""),
            choices: Array.isArray(q.choices) ? q.choices : [],
            points: num(q.points, 5),
          })),
          debug: {
            attemptTableUsed: attemptInfo.tableUsed,
            attemptPayloadUsed: attemptInfo.payloadUsed,
            warn: "ATTEMPT_UPDATE_FAILED_BUT_RETURNED_QUESTIONS",
            upErr,
          },
        },
        { status: 200 }
      );
    }

    // 5) 응답
    const outQuestions = picked.map((q) => ({
      id: String(q.id),
      content: String(q.content ?? ""),
      choices: Array.isArray(q.choices) ? q.choices : [],
      points: num(q.points, 5),
    }));

    return NextResponse.json({
      ok: true,
      attemptId,
      questions: outQuestions,
      debug: {
        attemptTableUsed: attemptInfo.tableUsed,
        attemptPayloadUsed: attemptInfo.payloadUsed,
        picked: outQuestions.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "START_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
