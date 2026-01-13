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

function getCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";").map((v) => v.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return "";
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
const ATTEMPT_TABLE = "attempts"; // ✅ 이제 attempts만 사용 (팀 분리 가능)

async function pickTeamFromAccounts(client: any, empId: string) {
  const { data, error } = await client
    .from("accounts")
    .select("username, emp_id, team, is_active")
    .or(`username.eq.${empId},emp_id.eq.${empId}`)
    .maybeSingle();

  if (error) throw { where: "accounts", error };
  if (!data) return { team: "A", isActive: true, found: false };

  if (data.is_active === false) {
    return { team: String(data.team || "A"), isActive: false, found: true };
  }

  return { team: String(data.team || "A"), isActive: true, found: true };
}

export async function POST(req: Request) {
  try {
    const { client, error: envErr } = getSupabaseAdmin();
    if (envErr) {
      return NextResponse.json({ ok: false, error: "ENV_ERROR", detail: envErr }, { status: 500 });
    }

    const cookieHeader = req.headers.get("cookie") || "";
    const empId = getCookie(cookieHeader, "empId"); // ✅ 로그인한 사람
    if (!empId) {
      return NextResponse.json({ ok: false, error: "NO_SESSION" }, { status: 401 });
    }

    // ✅ accounts에서 team 읽기
    const teamInfo = await pickTeamFromAccounts(client, empId);
    if (!teamInfo.isActive) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }
    const team = (teamInfo.team || "A").trim() || "A";

    const nowIso = new Date().toISOString();

    // 1) questions 조회: 내 팀만 + (includeOff 전략 유지)
    let qrows: any[] = [];
    {
      const r1 = await client
        .from(QUESTION_TABLE)
        .select("id, content, choices, points, is_active, team")
        .eq("team", team) // ✅ 팀 필터
        .eq("is_active", true)
        .limit(5000);

      if (!r1.error) qrows = r1.data || [];
      else {
        // is_active 컬럼이 없거나 캐시 문제 대비 fallback
        const r2 = await client
          .from(QUESTION_TABLE)
          .select("id, content, choices, points, team")
          .eq("team", team) // ✅ 팀 필터
          .limit(5000);

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
        { ok: false, error: "NO_QUESTIONS", detail: `questions returned 0 rows for team=${team}` },
        { status: 500 }
      );
    }

    // 2) 랜덤 20문제
    const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
    const pickedIds = picked.map((q) => String(q.id));
    const totalPoints = picked.reduce((sum, q) => sum + num(q.points, 5), 0);

    // 3) attempt 생성 (attempts만) + team 저장
    const insertPayload: any = {
      user_id: empId,     // ✅ anonymous 금지
      team,               // ✅ 팀 저장
      started_at: nowIso,
      duration_sec: 900,
      total_points: totalPoints,
      questions: pickedIds,
      answers: [],
      wrongs: [],
      submitted_at: null,
      score: 0,
    };

    const { data: attempt, error: insErr } = await client
      .from(ATTEMPT_TABLE)
      .insert(insertPayload)
      .select("id")
      .single();

    if (insErr || !attempt?.id) {
      return NextResponse.json(
        { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: insErr ?? "no id" },
        { status: 500 }
      );
    }

    const attemptId = String(attempt.id);

    // 4) 응답
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
        empId,
        team,
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
