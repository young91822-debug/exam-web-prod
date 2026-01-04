import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const attempt_id = Number(url.searchParams.get("attempt_id"));
    if (!Number.isFinite(attempt_id)) {
      return NextResponse.json({ ok: false, error: "attempt_id가 필요합니다." }, { status: 400 });
    }

    const { data: ans, error: ansErr } = await supabaseAdmin
      .from("exam_attempt_answers")
      .select("attempt_id, question_id, selected_index, is_correct")
      .eq("attempt_id", attempt_id)
      .eq("is_correct", false);

    if (ansErr) return NextResponse.json({ ok: false, error: ansErr.message }, { status: 500 });

    const wrong = ans ?? [];
    if (wrong.length === 0) {
      const emptyCsv = "\uFEFFattempt_id,question_id,question,correct_answer,user_answer\n";
      return new NextResponse(emptyCsv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="wrong_attempt_${attempt_id}.csv"`,
        },
      });
    }

    const qids = wrong.map((x: any) => x.question_id);
    const { data: qs, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, content, choices, answer_index")
      .in("id", qids);

    if (qErr) return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });

    const qMap = new Map<number, any>();
    (qs ?? []).forEach((q: any) => qMap.set(Number(q.id), q));

    const header = ["attempt_id", "question_id", "question", "correct_answer", "user_answer"].join(",") + "\n";

    const rows = wrong
      .map((w: any) => {
        const q = qMap.get(Number(w.question_id));
        const content = q?.content ?? "";
        const choices = Array.isArray(q?.choices) ? q.choices : [];
        const correctIdx = Number(q?.answer_index ?? -1);
        const userIdx = Number(w?.selected_index ?? -1);

        const correct = correctIdx >= 0 ? `${correctIdx + 1}. ${choices[correctIdx] ?? ""}` : "";
        const user = userIdx >= 0 ? `${userIdx + 1}. ${choices[userIdx] ?? ""}` : "";

        return [
          csvEscape(attempt_id),
          csvEscape(w.question_id),
          csvEscape(content),
          csvEscape(correct),
          csvEscape(user),
        ].join(",");
      })
      .join("\n");

    const csv = "\uFEFF" + header + rows + "\n";

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="wrong_attempt_${attempt_id}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
