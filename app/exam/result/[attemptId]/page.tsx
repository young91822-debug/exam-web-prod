// app/exam/result/[attemptId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type AnyResp = any;

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

async function fetchAny(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

/** ✅ index 값 강제 숫자화 (number | "1" | null → number|null) */
function toIndex(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function pickChoices(g: any): any[] {
  if (Array.isArray(g?.choices)) return g.choices;
  if (Array.isArray(g?.options)) return g.options;
  if (Array.isArray(g?.choice_list)) return g.choice_list;
  if (Array.isArray(g?.choice_texts)) return g.choice_texts;
  return [];
}

/** ✅ 다양한 API 형태를 "화면용" 하나로 통일 + selectedIndex를 attempt.answers로 보강 */
function normalizePayload(payload: any) {
  // attempt 후보
  const rawAttempt =
    payload?.attempt ??
    payload?.data?.attempt ??
    payload?.result?.attempt ??
    payload?.attemptInfo ??
    payload?.data ??
    payload ??
    null;

  const attempt = rawAttempt
    ? {
        empId:
          rawAttempt?.empId ??
          rawAttempt?.emp_id ??
          rawAttempt?.empid ??
          rawAttempt?.user_id ??
          rawAttempt?.userId ??
          "-",
        score: rawAttempt?.score ?? payload?.score ?? payload?.result?.score ?? 0,
        totalPoints:
          rawAttempt?.total_points ??
          rawAttempt?.totalPoints ??
          payload?.totalPoints ??
          payload?.result?.totalPoints ??
          "-",
        startedAt: rawAttempt?.started_at ?? rawAttempt?.startedAt ?? rawAttempt?.created_at ?? null,
        submittedAt: rawAttempt?.submitted_at ?? rawAttempt?.submittedAt ?? rawAttempt?.ended_at ?? null,
        // ✅ 여기 중요: /api/result 는 attempt.answers를 내려줌
        answers:
          rawAttempt?.answers && typeof rawAttempt.answers === "object"
            ? (rawAttempt.answers as Record<string, any>)
            : null,
      }
    : null;

  // graded 후보
  const rawGraded =
    payload?.graded ??
    payload?.wrongQuestions ??
    payload?.data?.graded ??
    payload?.result?.graded ??
    payload?.data?.wrongQuestions ??
    [];

  const graded = Array.isArray(rawGraded)
    ? rawGraded.map((g: any) => {
        const questionId = g?.questionId ?? g?.question_id ?? g?.id ?? null;

        // 1) graded 내부에서 먼저 찾기
        const selectedFromG =
          toIndex(g?.selectedIndex) ??
          toIndex(g?.selected_index) ??
          toIndex(g?.chosenIndex) ??
          toIndex(g?.chosen_index) ??
          toIndex(g?.answerIndex) ??
          toIndex(g?.answer_index);

        const correctFromG =
          toIndex(g?.correctIndex) ??
          toIndex(g?.correct_index) ??
          toIndex(g?.correctAnswerIndex) ??
          toIndex(g?.correct_answer_index) ??
          toIndex(g?.answerIndex) ??
          toIndex(g?.answer_index);

        // 2) graded에 없으면 attempt.answers[questionId]에서 보강
        const selectedFromAttempt =
          selectedFromG === null && attempt?.answers && questionId
            ? toIndex((attempt.answers as any)[String(questionId)])
            : null;

        const selectedIndex = selectedFromG ?? selectedFromAttempt;
        const correctIndex = correctFromG;

        const content =
          g?.content ??
          g?.question ??
          g?.questionText ??
          g?.title ??
          g?.question_title ??
          "";

        const choices = pickChoices(g);

        const isCorrect =
          typeof g?.isCorrect === "boolean"
            ? g.isCorrect
            : typeof g?.is_correct === "boolean"
            ? g.is_correct
            : correctIndex !== null &&
              selectedIndex !== null &&
              Number(correctIndex) === Number(selectedIndex);

        return {
          questionId,
          content,
          choices,
          selectedIndex,
          correctIndex,
          isCorrect,
          status: g?.status,
        };
      })
    : [];

  return { attempt, graded };
}

export default function ExamResultPage() {
  const p = useParams();
  const router = useRouter();

  const attemptId = useMemo(() => {
    const raw = (p as any)?.attemptId ?? (p as any)?.attemptID ?? "";
    return n(raw);
  }, [p]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [payload, setPayload] = useState<AnyResp | null>(null);
  const [debug, setDebug] = useState<any>(null);

  useEffect(() => {
    let dead = false;

    async function run() {
      if (!attemptId) {
        setErr("INVALID_ATTEMPT_ID");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      // ✅ 핵심: "내 선택" 보장하려면 attempt.answers가 있는 /api/result 를 써야 함
      const url = `/api/result/${attemptId}`;

      const r = await fetchAny(url);

      const looksOk = r.json && r.json.ok === true;
      if (looksOk) {
        if (dead) return;
        setPayload(r.json);
        setDebug({ used: url, status: r.status });
        setLoading(false);
        return;
      }

      if (dead) return;
      setErr(r.json?.error || "RESULT_API_FAILED");
      setDebug({ used: url, status: r.status, body: r.json ?? r.text });
      setLoading(false);
    }

    run();
    return () => {
      dead = true;
    };
  }, [attemptId]);

  if (loading) return <div style={{ padding: 16 }}>결과 불러오는 중…</div>;

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>결과 페이지 에러</div>
        <div style={{ marginTop: 8, color: "#b00", fontWeight: 700 }}>{err}</div>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{JSON.stringify(debug, null, 2)}</pre>

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push("/exam")}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", background: "white" }}
          >
            다시 시험 보기
          </button>
          <button
            onClick={() => location.reload()}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", background: "white" }}
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  const { attempt, graded } = normalizePayload(payload);

  const score = attempt?.score ?? "-";
  const totalPoints = attempt?.totalPoints ?? "-";
  const startedAt = attempt?.startedAt ?? null;
  const submittedAt = attempt?.submittedAt ?? null;

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>시험 결과</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>attemptId: {attemptId}</div>
        </div>
        <button
          onClick={() => router.push("/exam")}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", background: "white", fontWeight: 800 }}
        >
          다시 시험 보기
        </button>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>요약</div>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 6, columnGap: 10 }}>
          <div style={{ opacity: 0.7 }}>점수</div>
          <div style={{ fontWeight: 900 }}>
            {score} / {totalPoints}
          </div>

          <div style={{ opacity: 0.7 }}>응시 시작</div>
          <div>{fmt(startedAt)}</div>

          <div style={{ opacity: 0.7 }}>제출 시각</div>
          <div>{fmt(submittedAt)}</div>
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>debug: {JSON.stringify(debug)}</div>

      {Array.isArray(graded) && graded.length > 0 ? (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {graded.map((g: any, idx: number) => {
            const selectedIndex = toIndex(g?.selectedIndex);
            const correctIndex = toIndex(g?.correctIndex);

            const isWrong = g?.isCorrect === false || g?.status === "wrong";
            const isUnsubmitted = g?.status === "unsubmitted" || selectedIndex == null;

            const borderColor = isWrong ? "#ff3b30" : isUnsubmitted ? "#bbb" : "#eee";
            const bg = isWrong ? "rgba(255,59,48,0.04)" : isUnsubmitted ? "rgba(0,0,0,0.03)" : "white";

            const choices = Array.isArray(g?.choices) ? g.choices : [];

            return (
              <div
                key={String(g?.questionId ?? idx)}
                style={{ border: `2px solid ${borderColor}`, background: bg, borderRadius: 14, padding: 14 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 900 }}>
                    Q{idx + 1}. {g?.content ?? ""}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap" }}>
                    {isWrong ? "오답" : isUnsubmitted ? "미제출" : ""}
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {choices.map((c: any, i: number) => {
                    const tag =
                      correctIndex === i
                        ? "정답"
                        : selectedIndex !== null && selectedIndex === i
                        ? "내 선택"
                        : "";
                    return (
                      <div
                        key={i}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 12,
                          padding: "10px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {i + 1}. {String(c ?? "")}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 900, opacity: tag ? 0.9 : 0.2 }}>
                          {tag || "•"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                  <div>내 선택: {selectedIndex != null ? selectedIndex + 1 : "-"}</div>
                  <div>정답: {correctIndex != null ? correctIndex + 1 : "-"}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ marginTop: 14, padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
          표시할 상세 결과가 없습니다. (API가 graded를 안 내려주거나, 경로가 다를 수 있음)
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{JSON.stringify(payload, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
