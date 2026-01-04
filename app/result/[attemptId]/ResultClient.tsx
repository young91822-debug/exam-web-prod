// app/result/[attemptId]/ResultClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: number;
  content: string;
  choices: string[];
  points: number;
  answer_index: number;
  picked?: number;
};

async function safeJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: "INVALID_JSON", raw: text };
    }
  }
  return { ok: false, error: "NON_JSON", raw: text };
}

export default function ResultClient({ attemptId }: { attemptId: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg("");
      try {
        const res = await fetch(`/api/result/${attemptId}`, { cache: "no-store" });
        const json = await safeJson(res);

        if (!res.ok || !json?.ok) {
          setErrorMsg(JSON.stringify(json, null, 2));
          setLoading(false);
          return;
        }

        setData(json);
        setLoading(false);
      } catch (e: any) {
        setErrorMsg(e?.message ?? String(e));
        setLoading(false);
      }
    })();
  }, [attemptId]);

  const items: Item[] = useMemo(() => {
    const rawList = (data?.items ?? data?.wrongQuestions ?? data?.questions ?? []) as any[];
    return (rawList || []).map((x: any, idx: number) => {
      const id = Number(x?.id ?? x?.questionId ?? x?.question_id ?? x?.question?.id ?? idx);
      const content = String(x?.content ?? x?.question?.content ?? "");
      const choices = (x?.choices ?? x?.question?.choices ?? []) as string[];
      const points = Number(x?.points ?? x?.question?.points ?? 0);
      const answer_index = Number(x?.answer_index ?? x?.answerIndex ?? x?.question?.answer_index ?? 0);

      const pickedRaw =
        x?.picked ??
        x?.picked_index ??
        x?.user_answer_index ??
        x?.myAnswer ??
        x?.selectedIndex;

      const picked =
        typeof pickedRaw === "number"
          ? pickedRaw
          : typeof pickedRaw === "string"
          ? Number(pickedRaw)
          : undefined;

      return { id, content, choices, points, answer_index, picked };
    });
  }, [data]);

  // ✅ 점수는 "퍼센트(0~100)"만 표시
  const percent = useMemo(() => {
    // 서버가 percent 주면 우선 사용
    if (typeof data?.percent === "number") return data.percent;

    // 서버가 score(원점수)를 주는 경우를 대비해 계산 (안 오면 0)
    const scorePoints =
      typeof data?.scorePoints === "number"
        ? data.scorePoints
        : typeof data?.score === "number"
        ? data.score
        : 0;

    const totalPoints =
      typeof data?.totalPoints === "number"
        ? data.totalPoints
        : items.reduce((s, q) => s + (Number(q.points) || 0), 0);

    if (totalPoints <= 0) return 0;
    return Math.round((scorePoints / totalPoints) * 100);
  }, [data?.percent, data?.scorePoints, data?.score, data?.totalPoints, items]);

  // ✅ 틀린 문항 개수: 서버가 wrongQuestionIds를 주면 그걸 사용(가장 정확)
  const wrongCount = useMemo(() => {
    if (Array.isArray(data?.wrongQuestionIds)) return data.wrongQuestionIds.length;

    // fallback: picked가 있는 것만 비교
    return items.filter((q) => typeof q.picked === "number" && q.picked !== q.answer_index).length;
  }, [data?.wrongQuestionIds, items]);

  if (loading) return <div style={{ padding: 24, fontFamily: "system-ui" }}>결과 불러오는 중...</div>;

  if (errorMsg) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", whiteSpace: "pre-wrap", color: "crimson" }}>
        {errorMsg}
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>시험</h1>

      <div style={{ marginBottom: 12, color: "#555" }}>
        attemptId: <b>{attemptId}</b> / 문항수: <b>{items.length}</b>
      </div>

      <div style={{ border: "2px solid #111", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>
          점수: <span style={{ fontSize: 22 }}>{percent}</span>
          <span style={{ fontWeight: 700, color: "#666" }}> / 100</span>
        </div>

        <div style={{ marginTop: 6, fontWeight: 800 }}>틀린 문항 ({wrongCount}개)</div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {items.map((q, idx) => {
          const my = typeof q.picked === "number" ? q.picked : -1;

          return (
            <div key={`q-${q.id}-${idx}`} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 10 }}>
                {idx + 1}. {q.content} <span style={{ color: "#888", fontWeight: 700 }}>({q.points}점)</span>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {q.choices.map((c, i) => {
                  const isCorrect = i === q.answer_index;
                  const isMine = i === my;

                  let bg = "#fff";
                  let left = "•";
                  let label = "";

                  if (isCorrect) {
                    bg = "#eaffea";
                    left = "✅";
                    label = " (정답)";
                  } else if (isMine) {
                    bg = "#ffecec";
                    left = "❌";
                    label = " (내 답)";
                  }

                  return (
                    <div
                      key={`choice-${q.id}-${i}`}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #eee",
                        background: bg,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ width: 22, textAlign: "center" }}>{left}</span>
                      <div style={{ flex: 1 }}>
                        {c}
                        {label && <b>{label}</b>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
