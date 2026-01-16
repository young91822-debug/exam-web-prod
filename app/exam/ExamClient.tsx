// app/exam/ExamClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Q = {
  id: string;
  content: string;
  choices: string[];
  points?: number;
};

type StartResp =
  | { ok: true; attemptId: string; questions: Q[]; debug?: any }
  | { ok: false; error: string; detail?: any };

type SubmitResp =
  | {
      ok: true;
      attemptId: string;
      score: number;
      totalPoints?: number;
      correctCount?: number;
      wrongQuestionIds?: string[];
      debug?: any;
    }
  | { ok: false; error: string; detail?: any };

function safeText(v: any) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function fmtRemain(sec: number) {
  const s = Math.max(0, n(sec, 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const EXAM_LIMIT_SEC = 15 * 60;

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        borderRadius: 999,
        border: "2px solid rgba(255,255,255,0.45)",
        borderTopColor: "rgba(255,255,255,0.95)",
        animation: "spin 0.9s linear infinite",
      }}
    />
  );
}

export default function ExamClient() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [errText, setErrText] = useState("");

  const [remainSec, setRemainSec] = useState(EXAM_LIMIT_SEC);
  const submittingRef = useRef(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErrText("");
      setRemainSec(EXAM_LIMIT_SEC);
      submittingRef.current = false;

      try {
        const res = await fetch("/api/exam/start", {
          method: "POST",
          cache: "no-store",
          credentials: "include", // ✅ 쿠키 강제 포함
        });

        const json: StartResp = await res.json().catch(() => ({} as any));
        const errCode = (json as any)?.error || "";

        // ✅ 세션 없으면 로그인으로
        if (res.status === 401) {
          router.replace("/login?next=/exam");
          return;
        }

        // ✅ 관리자 차단이면 관리자 페이지로
        if (res.status === 403 && errCode === "ADMIN_CANNOT_TAKE_EXAM") {
          router.replace("/admin");
          return;
        }

        if (!res.ok || (json as any).ok !== true) {
          const msg = errCode || `START_FAILED (status ${res.status})`;
          const detail = (json as any)?.detail;
          throw new Error(detail ? `${msg}\n${safeText(detail)}` : msg);
        }

        if (!alive) return;

        setAttemptId(String((json as any).attemptId));
        setQuestions((json as any).questions || []);
        setAnswers({});
      } catch (e: any) {
        if (!alive) return;
        setErrText(String(e?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    if (!attemptId) return;

    const t = window.setInterval(() => {
      setRemainSec((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          window.clearInterval(t);
          submit(true);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  function choose(qid: string, idx: number) {
    setAnswers((prev) => ({ ...prev, [qid]: idx }));
  }

  async function submit(isAuto = false) {
    if (submittingRef.current) return;
    if (!attemptId) {
      setErrText("attemptId 없음");
      return;
    }

    if (!isAuto && Object.keys(answers).length === 0) {
      setErrText("답안을 하나도 선택하지 않았습니다.");
      return;
    }

    submittingRef.current = true;
    setErrText("");

    try {
      const res = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include", // ✅ 쿠키 포함
        body: JSON.stringify({ attemptId, answers, isAuto }),
      });

      const json: SubmitResp = await res.json().catch(() => ({} as any));

      if (res.status === 401) {
        router.replace("/login?next=/exam");
        return;
      }

      if (!res.ok || (json as any).ok !== true) {
        const msg = (json as any)?.error || `SUBMIT_FAILED (status ${res.status})`;
        const detail = (json as any)?.detail;
        throw new Error(detail ? `${msg}\n${safeText(detail)}` : msg);
      }

      const id = String((json as any).attemptId ?? attemptId);
      router.push(`/exam/result/${id}`);
    } catch (e: any) {
      submittingRef.current = false;
      setErrText(String(e?.message ?? e));
    }
  }

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const total = questions.length || 0;
  const progress = total > 0 ? Math.round((answeredCount / total) * 100) : 0;

  // --- UI styles ---
  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    padding: 24,
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(99,102,241,0.22), transparent 60%)," +
      "radial-gradient(900px 500px at 80% 30%, rgba(16,185,129,0.18), transparent 60%)," +
      "radial-gradient(800px 400px at 50% 95%, rgba(236,72,153,0.12), transparent 60%)," +
      "linear-gradient(180deg, #0b1020 0%, #070a12 100%)",
    color: "white",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  };

  const shellStyle: React.CSSProperties = {
    maxWidth: 980,
    margin: "0 auto",
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.42)",
    backdropFilter: "blur(12px)",
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <style>{`
          @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        `}</style>
        <div style={shellStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>시험</div>
              <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.65)" }}>문항을 불러오는 중…</div>
            </div>
            <div style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <Spinner />
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Loading</span>
            </div>
          </div>

          <div style={{ marginTop: 14, ...cardStyle, padding: 16 }}>
            <div style={{ height: 12, width: 140, borderRadius: 999, background: "rgba(255,255,255,0.10)" }} />
            <div style={{ marginTop: 10, height: 10, width: "75%", borderRadius: 999, background: "rgba(255,255,255,0.08)" }} />
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ ...cardStyle, padding: 14 }}>
                  <div style={{ height: 12, width: "60%", borderRadius: 8, background: "rgba(255,255,255,0.10)" }} />
                  <div style={{ marginTop: 10, height: 36, borderRadius: 12, background: "rgba(255,255,255,0.07)" }} />
                  <div style={{ marginTop: 8, height: 36, borderRadius: 12, background: "rgba(255,255,255,0.06)" }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .smooth { transition: all 160ms ease; }
        .hoverLift:hover { transform: translateY(-1px); }
        .choiceBtn:hover { border-color: rgba(255,255,255,0.22); background: rgba(255,255,255,0.08); }
        .choiceBtn:focus { outline: none; box-shadow: 0 0 0 4px rgba(99,102,241,0.18); }
      `}</style>

      <div style={shellStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: -0.2 }}>시험</div>
            <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.68)" }}>
              문항을 선택하고 제출하세요. 자동 제출(시간 종료)이 있습니다.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 6,
              justifyItems: "end",
              minWidth: 220,
            }}
          >
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
              진행도: <b style={{ color: "white" }}>{answeredCount}</b> / <b style={{ color: "white" }}>{total}</b> ({progress}%)
            </div>

            <div
              style={{
                height: 10,
                width: 220,
                borderRadius: 999,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.10)",
                overflow: "hidden",
              }}
              aria-label="progress"
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, rgba(99,102,241,0.95), rgba(34,197,94,0.95))",
                }}
              />
            </div>
          </div>
        </div>

        {/* Summary / Timer */}
        <div style={{ marginTop: 14, ...cardStyle, padding: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div
                style={{
                  height: 44,
                  width: 44,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.06)",
                  display: "grid",
                  placeItems: "center",
                }}
                aria-hidden
              >
                ⏱️
              </div>
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>남은 시간</div>
                <div style={{ fontSize: 18, fontWeight: 950, color: remainSec <= 60 ? "#fb7185" : "white" }}>
                  {fmtRemain(remainSec)}
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.65)" }}>
                    / 15:00
                  </span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
              attemptId: <b style={{ color: "rgba(255,255,255,0.85)" }}>{attemptId ?? "-"}</b>
            </div>
          </div>

          {errText ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 14,
                border: "1px solid rgba(244,63,94,0.25)",
                background: "rgba(244,63,94,0.10)",
                color: "rgba(255,255,255,0.92)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 6 }}>오류</div>
              <div style={{ color: "rgba(255,255,255,0.86)" }}>{errText}</div>
            </div>
          ) : null}
        </div>

        {/* Questions */}
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {questions.map((q, qi) => {
            const picked = answers[q.id];
            const points = n(q.points, 5);

            return (
              <div key={q.id} style={{ ...cardStyle, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 950, lineHeight: 1.35 }}>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
                      Q{qi + 1} <span style={{ marginLeft: 8, opacity: 0.85 }}>·</span>{" "}
                      <span style={{ marginLeft: 8 }}>{points}점</span>
                    </div>
                    <div style={{ fontSize: 16, color: "rgba(255,255,255,0.95)", whiteSpace: "pre-wrap" }}>
                      {q.content}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: picked == null ? "rgba(255,255,255,0.05)" : "rgba(34,197,94,0.14)",
                      color: picked == null ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.92)",
                      fontSize: 12,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {picked == null ? "미선택" : `선택: ${picked + 1}번`}
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {(q.choices || []).map((c, idx) => {
                    const active = picked === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => choose(q.id, idx)}
                        className="smooth hoverLift choiceBtn"
                        style={{
                          textAlign: "left",
                          padding: "12px 12px",
                          borderRadius: 14,
                          border: active ? "1px solid rgba(99,102,241,0.45)" : "1px solid rgba(255,255,255,0.10)",
                          background: active ? "rgba(99,102,241,0.14)" : "rgba(255,255,255,0.05)",
                          color: "rgba(255,255,255,0.92)",
                          cursor: "pointer",
                        }}
                        aria-pressed={active}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <div
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 10,
                              display: "grid",
                              placeItems: "center",
                              border: active ? "1px solid rgba(99,102,241,0.55)" : "1px solid rgba(255,255,255,0.10)",
                              background: active ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.05)",
                              fontWeight: 900,
                              color: "rgba(255,255,255,0.90)",
                              flex: "0 0 auto",
                            }}
                          >
                            {idx + 1}
                          </div>
                          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{c}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky Submit */}
        <div
          style={{
            position: "sticky",
            bottom: 14,
            marginTop: 16,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              ...cardStyle,
              padding: 14,
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>
              선택 완료: <b style={{ color: "white" }}>{answeredCount}</b> / <b style={{ color: "white" }}>{total}</b>
              {answeredCount === 0 ? (
                <span style={{ marginLeft: 10, color: "rgba(255,255,255,0.50)" }}>답안을 선택하면 제출할 수 있어요.</span>
              ) : null}
            </div>

            <button
              onClick={() => submit(false)}
              disabled={submittingRef.current}
              className="smooth hoverLift"
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: submittingRef.current
                  ? "rgba(255,255,255,0.10)"
                  : "linear-gradient(90deg, rgba(99,102,241,0.95), rgba(34,197,94,0.95))",
                color: "white",
                cursor: submittingRef.current ? "not-allowed" : "pointer",
                fontWeight: 950,
                minWidth: 140,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                opacity: submittingRef.current ? 0.75 : 1,
                boxShadow: submittingRef.current ? "none" : "0 14px 30px rgba(99,102,241,0.22)",
              }}
            >
              {submittingRef.current ? (
                <>
                  <Spinner />
                  제출 중…
                </>
              ) : (
                "제출하기"
              )}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
          © {new Date().getFullYear()} Exam Web • Internal Use Only
        </div>
      </div>
    </div>
  );
}
