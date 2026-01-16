// app/exam/ExamClient.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
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

  if (loading) return <div style={{ padding: 16 }}>로딩중...</div>;

  return (
    <div style={{ padding: 16, maxWidth: 860, fontFamily: "system-ui" }}>
      <div style={{ fontSize: 22, fontWeight: 900 }}>시험</div>

      <div style={{ marginTop: 8, fontWeight: 900, color: "crimson" }}>
        ⏰ 남은 시간: {fmtRemain(remainSec)} (15분 제한)
      </div>

      <div style={{ marginTop: 6, opacity: 0.7 }}>
        attemptId: <b>{attemptId ?? "-"}</b> / 문항수: <b>{questions.length}</b>
      </div>

      {errText ? (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 12,
            border: "1px solid #ffd2d2",
            background: "#fff5f5",
            color: "crimson",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          {errText}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {questions.map((q, qi) => {
          const picked = answers[q.id];
          return (
            <div
              key={q.id}
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: 14,
                padding: 12,
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 900 }}>
                {qi + 1}. {q.content} ({n(q.points, 5)}점)
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {(q.choices || []).map((c, idx) => {
                  const active = picked === idx;
                  return (
                    <button
                      key={idx}
                      onClick={() => choose(q.id, idx)}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #eee",
                        background: active ? "#eef6ff" : "#fafafa",
                        fontWeight: active ? 900 : 500,
                        cursor: "pointer",
                      }}
                    >
                      {idx + 1}) {c}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => submit(false)}
          disabled={submittingRef.current}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 900,
            opacity: submittingRef.current ? 0.6 : 1,
          }}
        >
          제출하기
        </button>
      </div>
    </div>
  );
}
