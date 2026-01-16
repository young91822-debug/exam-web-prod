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
        answers:
          rawAttempt?.answers && typeof rawAttempt.answers === "object"
            ? (rawAttempt.answers as Record<string, any>)
            : null,
      }
    : null;

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

  const pageBg: React.CSSProperties = {
    minHeight: "100vh",
    padding: 16,
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.14), transparent 60%)," +
      "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.12), transparent 60%)," +
      "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
    color: "white",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  };

  const container: React.CSSProperties = { maxWidth: 980, margin: "0 auto" };

  const card: React.CSSProperties = {
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    padding: 16,
    backdropFilter: "blur(10px)",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
  };

  const pill = (bg: string, fg: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: bg,
    color: fg,
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  });

  if (loading) {
    return (
      <div style={pageBg}>
        <div style={container}>
          <div style={card}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>결과 불러오는 중…</div>
            <div style={{ marginTop: 8, color: "rgba(255,255,255,0.70)", fontSize: 13 }}>
              잠시만 기다려 주세요.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={pageBg}>
        <div style={container}>
          <div style={card}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>결과 페이지 에러</div>
            <div style={{ marginTop: 8, color: "#ffb4b4", fontWeight: 900 }}>{err}</div>

            <pre style={{ whiteSpace: "pre-wrap", marginTop: 12, color: "rgba(255,255,255,0.75)" }}>
              {JSON.stringify(debug, null, 2)}
            </pre>

            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => router.push("/exam")} style={btn}>
                다시 시험 보기
              </button>
              <button onClick={() => location.reload()} style={btn}>
                새로고침
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { attempt, graded } = normalizePayload(payload);

  const score = attempt?.score ?? "-";
  const totalPoints = attempt?.totalPoints ?? "-";
  const startedAt = attempt?.startedAt ?? null;
  const submittedAt = attempt?.submittedAt ?? null;

  // 상태 배지
  const total = Array.isArray(graded) ? graded.length : 0;
  const wrong = Array.isArray(graded) ? graded.filter((g: any) => g?.isCorrect === false || g?.status === "wrong").length : 0;
  const unsubmitted = Array.isArray(graded) ? graded.filter((g: any) => (g?.status === "unsubmitted" || toIndex(g?.selectedIndex) == null)).length : 0;

  return (
    <div style={pageBg}>
      <style>{`
        .smooth { transition: all 160ms ease; }
        .lift:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); }
        .choice:hover { background: rgba(255,255,255,0.07); }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      `}</style>

      <div style={container}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 950, letterSpacing: -0.2 }}>시험 결과</div>
            <div className="mono" style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.60)" }}>
              attemptId: {attemptId}
            </div>
          </div>

          <button onClick={() => router.push("/exam")} className="smooth lift" style={btn}>
            다시 시험 보기 →
          </button>
        </div>

        {/* Summary */}
        <div style={{ marginTop: 12, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 950 }}>요약</div>
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.70)", fontSize: 13 }}>
                점수와 제출 정보를 확인하세요.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={pill("rgba(34,197,94,0.12)", "rgba(255,255,255,0.92)")}>✅ 총 {total}문항</span>
              <span style={pill("rgba(239,68,68,0.12)", "rgba(255,255,255,0.92)")}>❌ 오답 {wrong}</span>
              <span style={pill("rgba(148,163,184,0.12)", "rgba(255,255,255,0.82)")}>⏸ 미제출 {unsubmitted}</span>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "140px 1fr", rowGap: 8, columnGap: 10, fontSize: 13 }}>
            <div style={{ color: "rgba(255,255,255,0.65)" }}>점수</div>
            <div style={{ fontWeight: 950 }}>
              {score} <span style={{ color: "rgba(255,255,255,0.60)" }}>/ {totalPoints}</span>
            </div>

            <div style={{ color: "rgba(255,255,255,0.65)" }}>응시 시작</div>
            <div>{fmt(startedAt)}</div>

            <div style={{ color: "rgba(255,255,255,0.65)" }}>제출 시각</div>
            <div>{fmt(submittedAt)}</div>
          </div>
        </div>

        {/* Debug (접기 느낌) */}
        <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          debug: <span className="mono">{JSON.stringify(debug)}</span>
        </div>

        {/* Questions */}
        {Array.isArray(graded) && graded.length > 0 ? (
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {graded.map((g: any, idx: number) => {
              const selectedIndex = toIndex(g?.selectedIndex);
              const correctIndex = toIndex(g?.correctIndex);

              const isWrong = g?.isCorrect === false || g?.status === "wrong";
              const isUnsubmitted = g?.status === "unsubmitted" || selectedIndex == null;

              const borderColor = isWrong ? "rgba(239,68,68,0.75)" : isUnsubmitted ? "rgba(148,163,184,0.45)" : "rgba(255,255,255,0.10)";
              const bg = isWrong ? "rgba(239,68,68,0.06)" : isUnsubmitted ? "rgba(148,163,184,0.06)" : "rgba(255,255,255,0.05)";

              const choices = Array.isArray(g?.choices) ? g.choices : [];

              return (
                <div key={String(g?.questionId ?? idx)} style={{ ...card, borderColor, background: bg, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 950, fontSize: 15 }}>
                      Q{idx + 1}. {g?.content ?? ""}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {isWrong ? (
                        <span style={pill("rgba(239,68,68,0.16)", "rgba(255,255,255,0.92)")}>오답</span>
                      ) : isUnsubmitted ? (
                        <span style={pill("rgba(148,163,184,0.16)", "rgba(255,255,255,0.82)")}>미제출</span>
                      ) : (
                        <span style={pill("rgba(34,197,94,0.16)", "rgba(255,255,255,0.92)")}>정답</span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    {choices.map((c: any, i: number) => {
                      const isCorrectChoice = correctIndex === i;
                      const isMyChoice = selectedIndex !== null && selectedIndex === i;

                      const chip = isCorrectChoice ? "정답" : isMyChoice ? "내 선택" : "";
                      const chipBg = isCorrectChoice
                        ? "rgba(34,197,94,0.18)"
                        : isMyChoice
                        ? "rgba(99,102,241,0.18)"
                        : "transparent";

                      return (
                        <div
                          key={i}
                          className="smooth choice"
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: "10px 12px",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ whiteSpace: "pre-wrap", color: "rgba(255,255,255,0.92)" }}>
                            <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 800 }}>{i + 1}.</span>{" "}
                            {String(c ?? "")}
                          </div>

                          <div
                            style={{
                              minWidth: 54,
                              textAlign: "right",
                              fontSize: 12,
                              fontWeight: 950,
                              color: chip ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.20)",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: chip ? "6px 10px" : "6px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: chip ? chipBg : "rgba(255,255,255,0.06)",
                              }}
                            >
                              {chip || "•"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
                    <span style={pill("rgba(99,102,241,0.12)", "rgba(255,255,255,0.92)")}>
                      내 선택: {selectedIndex != null ? selectedIndex + 1 : "-"}
                    </span>
                    <span style={pill("rgba(34,197,94,0.12)", "rgba(255,255,255,0.92)")}>
                      정답: {correctIndex != null ? correctIndex + 1 : "-"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ marginTop: 14, ...card }}>
            표시할 상세 결과가 없습니다. (API가 graded를 안 내려주거나, 경로가 다를 수 있음)
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 12, color: "rgba(255,255,255,0.75)" }}>
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}

        <div style={{ marginTop: 18, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          © {new Date().getFullYear()} Exam Web • Internal Use Only
        </div>
      </div>
    </div>
  );
}
