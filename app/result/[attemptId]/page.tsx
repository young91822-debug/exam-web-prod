// app/result/[attemptId]/page.tsx
"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type WrongQ = {
  id: number;
  content: string;
  choices: string[];
  points: number;
  answer_index?: number | null;
  picked_index?: number | null;
};

type ResultData = {
  ok: boolean;
  attemptId: number;
  score: number;
  totalQuestions: number;
  totalPoints?: number;
  wrongCount: number;
  wrongQuestions: WrongQ[];
  empId?: string | null;
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

export default function ResultPage(props: { params: Promise<{ attemptId: string }> }) {
  // ✅ Next 16 params Promise 경고 해결
  const { attemptId } = use(props.params);

  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [data, setData] = useState<ResultData | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg("");
      setData(null);

      try {
        const res = await fetch(`/api/result/${encodeURIComponent(attemptId)}`, {
          method: "GET",
          cache: "no-store",
        });

        const parsed = await safeReadResponse(res);

        if (!res.ok) {
          const msg =
            parsed.kind === "json"
              ? JSON.stringify(parsed.data, null, 2)
              : parsed.raw || `결과 조회 실패 (status ${res.status})`;
          setErrorMsg(`에러: 결과 조회 실패 (status ${res.status})\n${msg}`);
          setLoading(false);
          return;
        }

        const d = parsed.kind === "json" ? (parsed.data as ResultData) : null;
        if (!d?.ok) {
          setErrorMsg(`에러: 결과 응답이 이상함\n${parsed.raw}`);
          setLoading(false);
          return;
        }

        setData(d);
        setLoading(false);
      } catch (e: any) {
        setErrorMsg(`에러: 네트워크/런타임 오류\n${e?.message ?? String(e)}`);
        setLoading(false);
      }
    })();
  }, [attemptId]);

  async function onLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 네트워크 실패해도 이동은 시킴
    }
    router.replace("/login");
  }

  if (loading) {
    return <div style={{ padding: 24, fontFamily: "system-ui" }}>결과 불러오는 중...</div>;
  }

  if (errorMsg) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", whiteSpace: "pre-wrap", color: "crimson" }}>
        {errorMsg}
      </div>
    );
  }

  if (!data) {
    return <div style={{ padding: 24, fontFamily: "system-ui" }}>결과가 없습니다.</div>;
  }

  const totalQ = data.totalQuestions ?? 0;
  const totalPoints = typeof data.totalPoints === "number" ? data.totalPoints : 100;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      {/* 상단: 제목 + 로그아웃 버튼 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>시험</h1>
          <div style={{ color: "#666" }}>
            attemptId: <b>{data.attemptId}</b> / 문항수: <b>{totalQ}</b>
          </div>
        </div>

        {/* ✅ 여기 = 너가 동그라미친 “오른쪽” 위치 */}
        <button
          onClick={onLogout}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          로그아웃
        </button>
      </div>

      {/* 점수 박스 */}
      <div
        style={{
          marginTop: 14,
          border: "2px solid #111",
          borderRadius: 12,
          padding: 14,
          maxWidth: 820,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          점수: {data.score} / {totalPoints}
        </div>
        <div style={{ fontWeight: 700 }}>틀린 문항 ({data.wrongCount}개)</div>
      </div>

      {/* 오답 리스트 */}
      <div style={{ marginTop: 16, maxWidth: 980, display: "grid", gap: 16 }}>
        {(data.wrongQuestions || []).map((q, idx) => {
          const picked = typeof q.picked_index === "number" ? q.picked_index : null;
          const ans = typeof q.answer_index === "number" ? q.answer_index : null;

          return (
            <div
              key={`${q.id}-${idx}`} // ✅ key 경고 제거
              style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 14 }}
            >
              <div style={{ fontWeight: 800, marginBottom: 10 }}>
                {idx + 1}. {q.content}{" "}
                <span style={{ color: "#777", fontWeight: 700 }}>({q.points ?? 0}점)</span>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {(q.choices || []).map((c, i) => {
                  const isAnswer = ans === i;
                  const isPicked = picked === i;

                  const bg = isAnswer ? "#e9fbe9" : isPicked ? "#fdecec" : "#fff";
                  const left = isAnswer ? "✅" : isPicked ? "❌" : "•";
                  const label = isAnswer ? " (정답)" : isPicked ? " (내 답)" : "";

                  return (
                    <div
                      key={`${q.id}-c-${i}`}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: "10px 12px",
                        background: bg,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ width: 24, textAlign: "center" }}>{left}</span>
                      <span>
                        {c}
                        <b>{label}</b>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
        <button
          onClick={() => router.replace("/exam")}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
        >
          다시 응시
        </button>
      </div>
    </div>
  );
}
