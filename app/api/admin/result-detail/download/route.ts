// app/api/admin/result-detail/download/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d: number | null = null) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : d;
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

function parseIdList(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return Array.from(new Set(raw.map((x) => s(x)).filter(Boolean)));

  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith("[") && t.endsWith("]")) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return Array.from(new Set(arr.map((x) => s(x)).filter(Boolean)));
      } catch {}
    }
    const sep = t.includes("|") ? "|" : ",";
    return Array.from(new Set(t.split(sep).map((x) => x.trim()).filter(Boolean)));
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

function pickSelectedIndex(a: any): number | null {
  const cands = [a?.selected_index, a?.selectedIndex, a?.answer_index, a?.answerIndex];
  for (const v of cands) {
    if (v === undefined || v === null || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function csvEscape(v: any) {
  const t = String(v ?? "");
  if (/[,"\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** UUID(attempts.id) -> legacy exam_attempts.id 매칭(±2분) */
async function resolveLegacyAttemptIdFromUuid(attemptUuid: string) {
  const { data: uuidAttempt, error: e1 } = await supabaseAdmin
    .from("attempts")
    .select("id, started_at")
    .eq("id", attemptUuid)
    .maybeSingle();

  if (e1) return { ok: false as const, error: "UUID_ATTEMPT_QUERY_FAILED", detail: e1 };
  if (!uuidAttempt) return { ok: false as const, error: "UUID_ATTEMPT_NOT_FOUND", detail: { attemptUuid } };

  const startedAt = (uuidAttempt as any)?.started_at;
  if (!startedAt) return { ok: false as const, error: "UUID_ATTEMPT_NO_STARTED_AT" };

  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime()))
    return { ok: false as const, error: "UUID_ATTEMPT_BAD_STARTED_AT", detail: startedAt };

  const t0 = new Date(d.getTime() - 2 * 60 * 1000).toISOString();
  const t1 = new Date(d.getTime() + 2 * 60 * 1000).toISOString();

  const { data: rows, error: e2 } = await supabaseAdmin
    .from("exam_attempts")
    .select("id, emp_id, started_at, submitted_at, score, total_points")
    .gte("started_at", t0)
    .lte("started_at", t1)
    .order("submitted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);

  if (e2) return { ok: false as const, error: "LEGACY_MATCH_QUERY_FAILED", detail: e2 };
  if (!rows || rows.length === 0)
    return { ok: false as const, error: "LEGACY_MATCH_NOT_FOUND", detail: { attemptUuid, t0, t1 } };

  const best =
    rows.find((r: any) => !!r?.emp_id) ??
    rows.find((r: any) => r?.score != null && r?.total_points != null) ??
    rows[0];

  return { ok: true as const, attemptId: Number(best.id), candidates: rows.map((r: any) => r.id) };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const attemptKeyRaw = s(searchParams.get("attemptId"));

    if (!attemptKeyRaw) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    // ✅ 숫자 or UUID 둘 다 받는다
    let attemptId: number | null = null;

    if (/^\d+$/.test(attemptKeyRaw)) {
      attemptId = n(attemptKeyRaw, null);
    } else if (isUuid(attemptKeyRaw)) {
      const resolved = await resolveLegacyAttemptIdFromUuid(attemptKeyRaw);
      if (!resolved.ok) {
        return NextResponse.json({ ok: false, error: resolved.error, detail: resolved.detail }, { status: 400 });
      }
      attemptId = resolved.attemptId;
      // (디버깅 필요하면 candidates를 meta로 같이 내려도 됨)
    }

    if (!attemptId || attemptId <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_ATTEMPT_ID" }, { status: 400 });
    }

    // 1) attempt
    const { data: attempt, error: aErr } = await supabaseAdmin
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
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    // 2) answers rows
    const { data: ansRows, error: ansErr } = await supabaseAdmin
      .from("exam_attempt_answers")
      .select("*")
      .eq("attempt_id", attemptId);

    if (ansErr) {
      return NextResponse.json(
        { ok: false, error: "ANSWERS_QUERY_FAILED", detail: String((ansErr as any)?.message ?? ansErr) },
        { status: 500 }
      );
    }

    // 3) question ids
    const qids = parseIdList(attempt.question_ids);
    const qidsFallback = qids.length
      ? qids
      : Array.from(new Set((ansRows ?? []).map((r: any) => s(r.question_id)).filter(Boolean)));

    if (!qidsFallback.length) {
      const header = ["attempt_id","emp_id","status","started_at","submitted_at","question_id","question","selected","correct","result"];
      const csv = "\ufeff" + header.join(",") + "\n";
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="result_${attemptId}.csv"`,
        },
      });
    }

    // 4) questions
    const { data: questions, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", qidsFallback);

    if (qErr) {
      return NextResponse.json(
        { ok: false, error: "QUESTIONS_QUERY_FAILED", detail: String((qErr as any)?.message ?? qErr) },
        { status: 500 }
      );
    }

    const qById = new Map<string, any>();
    for (const q of questions ?? []) qById.set(s(q.id), q);

    const aByQ = new Map<string, any>();
    for (const a of ansRows ?? []) aByQ.set(s(a.question_id), a);

    // ✅ 오답/미제출만
    const rows = qidsFallback
      .map((qid) => {
        const q = qById.get(s(qid));
        const a = aByQ.get(s(qid));

        const correctIndex = q ? pickCorrectIndex(q) : null;
        const selectedIndex = a ? pickSelectedIndex(a) : null;
        const submitted = selectedIndex !== null;

        const isCorrect = submitted && correctIndex !== null ? Number(selectedIndex) === Number(correctIndex) : false;

        // 맞은 문제 제외
        if (submitted && isCorrect) return null;

        const result = !submitted ? "미제출" : "오답";

        return {
          attempt_id: attemptId,
          emp_id: attempt?.emp_id ?? "",
          status: attempt?.status ?? "",
          started_at: attempt?.started_at ?? "",
          submitted_at: attempt?.submitted_at ?? "",
          question_id: s(qid),
          question: q?.content ?? "",
          selected: selectedIndex === null ? "" : String(Number(selectedIndex) + 1),
          correct: correctIndex === null ? "" : String(Number(correctIndex) + 1),
          result,
        };
      })
      .filter(Boolean) as any[];

    const header = ["attempt_id","emp_id","status","started_at","submitted_at","question_id","question","selected","correct","result"];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push(
        [
          r.attempt_id,
          csvEscape(r.emp_id),
          csvEscape(r.status),
          csvEscape(r.started_at),
          csvEscape(r.submitted_at),
          csvEscape(r.question_id),
          csvEscape(r.question),
          csvEscape(r.selected),
          csvEscape(r.correct),
          csvEscape(r.result),
        ].join(",")
      );
    }

    const csv = "\ufeff" + lines.join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="result_${attemptId}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "DOWNLOAD_FAILED", detail: String(e?.message ?? e) }, { status: 500 });
  }
}
