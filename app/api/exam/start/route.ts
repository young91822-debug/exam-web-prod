// app/api/exam/start/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
const sb: any = supabaseAdmin;

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

function isMissingColumn(err: any, col: string) {
  const msg = String(err?.message || err || "");
  // 예: column accounts.username does not exist
  // 예: Could not find the 'username' column of 'accounts' in the schema cache
  return (
    msg.includes(`column accounts.${col} does not exist`) ||
    msg.includes(`Could not find the '${col}' column`) ||
    (msg.toLowerCase().includes(col) && msg.toLowerCase().includes("does not exist"))
  );
}

// ✅ accounts에서 team 읽기 (없으면 A)
// ✅ username 컬럼이 없는 DB에서도 절대 안 터지게 안전 처리
async function pickTeamFromAccounts(empId: string) {
  // 1) emp_id로 먼저
  const r1 = await sb
    .from("accounts")
    .select("team, is_active, emp_id")
    .eq("emp_id", empId)
    .maybeSingle();

  if (r1.error) throw r1.error;
  if (r1.data) {
    const isActive = r1.data.is_active === false ? false : true;
    const team = s(r1.data.team || "A") || "A";
    return { team, isActive, matchedBy: "emp_id" as const };
  }

  // 2) 없으면 username으로 fallback (단, username 컬럼 없으면 스킵)
  const r2 = await sb
    .from("accounts")
    .select("team, is_active, emp_id")
    .eq("username", empId)
    .maybeSingle();

  if (r2.error) {
    // ✅ username 컬럼이 없으면 그냥 계정 없음 처리로 넘김
    if (isMissingColumn(r2.error, "username")) {
      return { team: "A", isActive: true, matchedBy: "none" as const, notFound: true as const };
    }
    throw r2.error;
  }

  if (!r2.data) {
    return { team: "A", isActive: true, matchedBy: "none" as const, notFound: true as const };
  }

  const isActive = r2.data.is_active === false ? false : true;
  const team = s(r2.data.team || "A") || "A";
  return { team, isActive, matchedBy: "username" as const };
}

export async function POST(req: Request) {
  try {
    const empId = s(getCookie(req, "empId"));
    if (!empId) {
      return NextResponse.json({ ok: false, error: "NO_SESSION" }, { status: 401 });
    }

    const teamInfo: any = await pickTeamFromAccounts(empId);

    if (teamInfo?.notFound) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_NOT_FOUND", detail: { empId } },
        { status: 401 }
      );
    }

    if (!teamInfo.isActive) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }

    const team = s(teamInfo.team || "A") || "A";

    // ✅ 내 팀 문제만 가져오기
    const q1 = await sb
      .from("questions")
      .select("id, content, choices, points, is_active, team")
      .eq("team", team)
      .eq("is_active", true)
      .limit(5000);

    if (q1.error) {
      // is_active 컬럼 없을 수도 있으니 fallback
      const q2 = await sb
        .from("questions")
        .select("id, content, choices, points, team")
        .eq("team", team)
        .limit(5000);

      if (q2.error) {
        return NextResponse.json(
          { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: q2.error },
          { status: 500 }
        );
      }

      if (!q2.data?.length) {
        return NextResponse.json(
          { ok: false, error: "NO_QUESTIONS", detail: { team } },
          { status: 500 }
        );
      }

      return await createAttemptAndRespond(empId, team, q2.data);
    }

    if (!q1.data?.length) {
      return NextResponse.json(
        { ok: false, error: "NO_QUESTIONS", detail: { team } },
        { status: 500 }
      );
    }

    return await createAttemptAndRespond(empId, team, q1.data);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "START_FATAL", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

async function createAttemptAndRespond(empId: string, team: string, qrows: any[]) {
  const picked = shuffle(qrows).slice(0, Math.min(20, qrows.length));
  const pickedIds = picked.map((q: any) => String(q.id));
  const totalPoints = picked.reduce((sum: number, q: any) => sum + n(q?.points, 5), 0);

  const nowIso = new Date().toISOString();

  const insertRow: any = {
    emp_id: empId,
    status: "STARTED",
    started_at: nowIso,
    submitted_at: null,
    total_questions: pickedIds.length,
    score: 0,
    question_ids: pickedIds,
    answers: {}, // map 형태(JSON)
    team,        // ✅ team 저장
    // total_points 는 DB 컬럼 없으면 넣지 말자 (안전)
  };

  const r1 = await sb.from("exam_attempts").insert(insertRow).select("id").single();

  if (r1.error || !r1.data?.id) {
    return NextResponse.json(
      { ok: false, error: "ATTEMPT_INSERT_FAILED", detail: r1.error ?? "no id" },
      { status: 500 }
    );
  }

  const attempt = r1.data;

  const outQuestions = picked.map((q: any) => ({
    id: String(q.id),
    content: String(q.content ?? ""),
    choices: Array.isArray(q.choices)
      ? q.choices
      : typeof q.choices === "string"
      ? safeParseChoices(q.choices)
      : [],
    points: n(q?.points, 5),
  }));

  return NextResponse.json({
    ok: true,
    attemptId: String(attempt.id),
    questions: outQuestions,
    debug: { empId, team, picked: outQuestions.length, totalPoints },
  });
}

function safeParseChoices(v: string): string[] {
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.map((x) => String(x ?? ""));
  } catch {}
  if (v.includes("|")) return v.split("|").map((x) => x.trim()).filter(Boolean);
  if (v.includes("\n")) return v.split("\n").map((x) => x.trim()).filter(Boolean);
  if (v.includes(",")) return v.split(",").map((x) => x.trim()).filter(Boolean);
  return v ? [v] : [];
}
