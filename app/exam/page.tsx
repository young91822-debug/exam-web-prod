// app/exam/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Q = {
  id: number;
  content: string;
  choices: string[];
  points: number;
};

type SubmitResult = {
  ok: boolean;
  attemptId: number;
};

async function safeReadResponse(res: Response) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  if (ct.includes("application/json")) {
    try {
      return { kind: "json" as const, data: JSON.parse(text), raw: text };
    } catch {
      return { kind: "text" as const, data: null, raw: text };
    }
  }
  return { kind: "text" as const, data: null, raw: text };
}

export default function ExamPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [errorMsg, setErrorMsg] = useState<string>("");

  const totalScore = useMemo(() => {
    return (questions || []).reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  }, [questions]);

  // 시험 시작
  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg("");

      try {
        const res = await fetch("/api/exam/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });

        const parsed = await safeReadResponse(res);

        if (!res.ok) {
          const msg =
            parsed.kind === "json"
              ? JSON.stringify(parsed.data, null, 2)
              : parsed.raw || `시험 시작 실패 (status ${res.status})`;
          setErrorMsg(`에러: 시험 시작 실패 (status ${res.status})\n${msg}`);
          setLoading(false);
          return;
        }

        const data = parsed.kind === "json" ? parsed.data : null;
        if (!data?.ok) {
          setErrorMsg(`에러: 시험 시작 응답이 이상함\n${parsed.raw}`);
          setLoading(false);
          return;
        }

        setAttemptId(Number(data.attemptId));
        setQuestions(data.questions || []);
        setAnswers({});
        setLoading(false);
      } catch (e: any) {
        setErrorMsg(`에러: 네트워크/런타임 오류\n${e?.message ?? String(e)}`);
        setLoading(false);
      }
    })();
  }, []);

  async function onSubmit() {
    if (!attemptId) {
      alert("attemptId가 없습니다. 다시 시작해 주세요.");
      return;
    }

    try {
      const res = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptId, answers }),
      });

      const parsed = await safeReadResponse(res);

      if (!res.ok) {
        const msg =
          parsed.kind === "json"
            ? JSON.stringify(parsed.data, null, 2)
            : parsed.raw || `제출 실패 (status ${res.status})`;
        alert(`제출 실패 (status ${res.status})\n${msg}`);
        return;
      }

      const data = (parsed.kind === "json" ? parsed.data : null) as SubmitResult | null;
      if (!data?.ok) {
        alert(`제출 응답이 이상함\n${parsed.raw}`);
        return;
      }

      router.push(`/result/${data.attemptId}`);
    } catch (e: any) {
      alert(`제출 중 오류\n${e?.message ?? String(e)}`);
    }
  }

  if (loading) {
    return <div style={{ padding: 24, fontFamily: "system-ui" }}>시험 불러오는 중...</div>;
  }

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
        attemptId: <b>{attemptId}</b> / 문항수: <b>{questions.length}</b> / 만점: <b>{totalScore}</b>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {questions.map((q, idx) => (
          <div key={q.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              {idx + 1}. {q.content}{" "}
              <span style={{ color: "#888", fontWeight: 600 }}>({q.points}점)</span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {q.choices.map((c, i) => {
                const checked = answers[q.id] === i;
                return (
                  <label key={i} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      checked={checked}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: i }))}
                    />
                    <span>{c}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <button
          onClick={() => router.refresh()}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
        >
          다시 시작
        </button>

        <button
          onClick={onSubmit}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #000", background: "#000", color: "#fff" }}
        >
          제출하기
        </button>
      </div>
    </div>
  );
}
