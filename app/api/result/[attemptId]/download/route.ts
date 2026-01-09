// app/api/admin/results/[attemptId]/download/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows: Record<string, any>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

function toInt(v: any, d: any = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function pickQid(a: any) {
  return a?.question_id ?? a?.q_id ?? a?.questionId ?? a?.question ?? a?.qid ?? null;
}

function pickSelected(a: any) {
  const v =
    a?.selected_index ??
    a?.choice_index ??
    a?.answer_index ??
    a?.selected ??
    a?.answer ??
    a?.selectedIndex ??
    a?.choiceIndex ??
    a?.answerIndex ??
    null;
  return v == null ? null : toInt(v, null);
}

function pickCorrect(q: any) {
  const v =
    q?.answer_index ??
    q?.correct_index ??
    q?.correct ??
    q?.correctAnswerIndex ??
    q?.correct_answer_index ??
    q?.answerIndex ??
    q?.correct_choice_index ??
    null;
  return v == null ? null : toInt(v, null);
}

async function pickAttempt(supabaseAdmin: any, attemptId: string) {
  const candidates = ["exam_attempts", "attempts"];
  for (const table of candidates) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();
    if (!error && data) return { table, attempt: data };
  }
  return null;
}

async function pickAnswers(supabaseAdmin: any, attemptId: string) {
  const tables = ["exam_attempt_answers", "exam_answers", "answers", "attempt_answers"];
  const keys = ["attempt_id", "attemptId", "attempt", "exam_attempt_id", "examAttemptId"];

  for (const table of tables) {
    for (const key of keys) {
      const { data, error } = await supabaseAdmin.from(table).select("*").eq(key as any, attemptId);
      if (!error && Array.isArray(data) && data.length > 0) {
        return { table, key, answers: data };
      }
    }
  }
  return { table: null as any, key: null as any, answers: [] as any[] };
}

async function pickQuestions(supabaseAdmin: any, questionIds: (string | number)[]) {
  if (!questionIds.length) return [] as any[];
  const { data, error } = await supabaseAdmin
    .from("questions")
    .select("*")
    .in("id", questionIds as any);
  if (error || !Array.isArray(data)) return [];
  return data;
}

export async function GET(req: Request, ctx: any) {
  try {
    const { client: supabaseAdmin, error: supErr } = getSupabaseAdmin();
    if (supErr) return NextResponse.json({ ok: false, error: supErr }, { status: 500 });

    const p = await Promise.resolve(ctx?.params);
    const attemptId = String(p?.attemptId ?? "").trim();
    if (!attemptId) {
      return NextResponse.json({ ok: false, error: "NO_ATTEMPT_ID" }, { status: 400 });
    }

    const picked = await pickAttempt(supabaseAdmin, attemptId);
    if (!picked) {
      return NextResponse.json({ ok: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 });
    }

    const { attempt } = picked;
    const empId = String(attempt.emp_id ?? attempt.user_id ?? attempt.account_id ?? "");
    const submittedAt =
      attempt.submitted_at ?? attempt.completed_at ?? attempt.ended_at ?? attempt.updated_at ?? "";

    const { table: answersTable, key: answersKey, answers } = await pickAnswers(supabaseAdmin, attemptId);

    const qidList: (string | number)[] = [];
    for (const a of answers) {
      const qid = pickQid(a);
      if (qid != null) qidList.push(qid);
    }

    const questions = await pickQuestions(supabaseAdmin, qidList);
    const qMap = new Map<any, any>();
    for (const q of questions) qMap.set(q.id, q);

    const rows: Record<string, any>[] = [];
    for (const a of answers) {
      const qid = pickQid(a);
      const selected = pickSelected(a);

      const q = qMap.get(qid);
      const correct = pickCorrect(q);

      rows.push({
        emp_id: empId,
        submitted_at: submittedAt,
        attempt_id: attemptId,
        question_id: qid ?? "",
        question: q?.content ?? q?.question ?? "",
        selected_index: selected ?? "",
        correct_index: correct ?? "",
        is_correct:
          selected == null || correct == null ? "" : Number(selected) === Number(correct) ? "Y" : "N",
      });
    }

    // rows가 0이면 diag 남김
    if (!rows.length) {
      const head =
        "emp_id,submitted_at,attempt_id,question_id,question,selected_index,correct_index,is_correct\n";
      const diag =
        `\n# DIAG: answersTable=${answersTable ?? "NONE"}, answersKey=${answersKey ?? "NONE"}, answersCount=${answers.length}, qidCount=${qidList.length}\n`;
      const csv = head + diag;

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="attempt_${attemptId}_results.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const csv = toCSV(rows);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attempt_${attemptId}_results.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "DOWNLOAD_FAILED", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
