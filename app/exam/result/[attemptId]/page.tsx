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

/** ✅ 다양한 API 형태를 "화면용" 하나로 통일 */
function normalizePayload(payload: any) {
  const rawAttempt =
    payload?.attempt ??
    payload?.data?.attempt ??
    payload?.result?.attempt ??
    payload ??
    null;

  // attempt 정규화
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
          "-", // 없으면 '-' 유지
        startedAt: rawAttempt?.started_at ?? rawAttempt?.startedAt ?? null,
        submittedAt: rawAttempt?.submitted_at ?? rawAttempt?.submittedAt ?? null,
      }
    : null;

  // graded 정규화
  const rawGraded =
    payload?.graded ??
    payload?.wrongQuestions ??
    payload?.data?.graded ??
    payload?.result?.graded ??
    [];

  const graded = Array.isArray(rawGraded)
    ? rawGraded.map((g: any) => {
        const choices = Array.isArray(g?.choices)
          ? g.choices
          : Array.isArray(g?.options)
          ? g.options
          : [];

        const selectedIndex =
          typeof g?.selectedIndex === "number"
            ? g.selectedIndex
            : typeof g?.chosenIndex === "number"
            ? g.chosenIndex
            : typeof g?.chosen_index === "number"
            ? g.chosen_index
            : typeof g?.answerIndex === "number"
            ? g.answerIndex
            : typeof g?.answer_index === "number"
            ? g.answer_index
            : null;

        const correctIndex =
          typeof g?.correctIndex === "number"
            ? g.correctIndex
            : typeof g?.correct_index === "number"
            ? g.correct_index
            : typeof g?.answerIndex === "number"
            ? g.answerIndex
            : typeof g?.answer_index === "number"
            ? g.answer_index
            : null;

        const content =
          g?.content ??
          g?.question ??
          g?.questionText ??
          g?.title ??
          "";

        const questionId = g?.questionId ?? g?.question_id ?? g?.id ?? null;

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

      // ✅ graded가 있는 "상세 API"를 최우선으로
      const tries = [
        `/api/result/${attemptId}`, // ✅ graded 있음 (너가 올린 route.ts)
        `/api/result/${attemptId}/summary`,
        `/api/admin/result-detail?attemptId=${attemptId}`,
      ];

      for (const url of tries) {
        const r = await fetchAny(url);

        // ✅ 성공 판정: HTTP ok가 아니어도 json.ok===true면 성공으로 인정
        const looksOk =
          (r.json && r.json.ok === true) ||
          (r.ok && r.json != null);

        if (looksOk) {
          if (dead) return;
          setPayload(r.json);
          setDebug({ used: url, status: r.status });
          setLoading(false);
          return;
        } else {
          if (!dead) {
            setDebug((prev: any) => prev ?? { lastTried: url, status: r.status, textLen: (r.text || "").length });
          }
        }
      }

      if (dead) return;
      setErr("RESULT_API_NOT_FOUND_OR_FAILED");
      setLoading(false);
    }

    run();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
            }}
          >
            다시 시험 보기
          </button>
          <button
            onClick={() => location.reload()}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
            }}
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>시험 결과</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
            attemptId: {attemptId}
          </div>
        </div>
        <button
          onClick={() => router.push("/exam")}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            fontWeight: 800,
          }}
        >
          다시 시험 보기
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          border: "1px solid #eee",
          borderRadius: 14,
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>요약</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr",
            rowGap: 6,
            columnGap: 10,
          }}
        >
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

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
        debug: {JSON.stringify(debug)}
      </div>

      {Array.isArray(graded) && graded.length > 0 ? (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {graded.map((g: any, idx: number) => {
            const isWrong = g?.isCorrect === false || g?.status === "wrong";
            const isUnsubmitted =
              g?.status === "unsubmitted" || g?.selectedIndex == null;

            const borderColor = isWrong ? "#ff3b30" : isUnsubmitted ? "#bbb" : "#eee";
            const bg = isWrong ? "rgba(255,59,48,0.04)" : isUnsubmitted ? "rgba(0,0,0,0.03)" : "white";

            const choices = Array.isArray(g?.choices) ? g.choices : [];
            const selectedIndex = typeof g?.selectedIndex === "number" ? g.selectedIndex : null;
            const correctIndex = typeof g?.correctIndex === "number" ? g.correctIndex : null;

            return (
              <div
                key={String(g?.questionId ?? idx)}
                style={{
                  border: `2px solid ${borderColor}`,
                  background: bg,
                  borderRadius: 14,
                  padding: 14,
                }}
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
                        : !isUnsubmitted && selectedIndex === i
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
                  <div>내 선택: {isUnsubmitted ? "-" : selectedIndex != null ? selectedIndex + 1 : "-"}</div>
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
