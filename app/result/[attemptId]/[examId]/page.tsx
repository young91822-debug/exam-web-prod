// app/result/[attemptId]/[examId]/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ResultData = {
  ok?: boolean;
  empId?: string;
  attemptId?: number | string;
  score?: number;
  submittedAt?: string;
  totalQuestions?: number;
  correctCount?: number;
  wrongCount?: number;
  wrongQuestions?: Array<{
    questionId?: number;
    question?: string;
    selected?: string;
    answer?: string;
  }>;
  error?: string;
  detail?: any;
};

export default function ResultDetailPage({ params }: { params: { attemptId: string; examId: string } }) {
  const attemptId = params?.attemptId;
  const examId = params?.examId;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ResultData | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // ✅ 결과 API가 여러 형태일 수 있어서 가장 흔한 2가지를 순서대로 시도
        // 1) /api/result/[attemptId]
        // 2) /api/result/[attemptId]?examId=...
        let res = await fetch(`/api/result/${encodeURIComponent(String(attemptId))}`, { cache: "no-store" });

        // 혹시 examId가 필요하면 쿼리로 재시도
        if (!res.ok && examId) {
          res = await fetch(
            `/api/result/${encodeURIComponent(String(attemptId))}?examId=${encodeURIComponent(String(examId))}`,
            { cache: "no-store" }
          );
        }

        const json = await res.json().catch(() => null);

        if (!res.ok) {
          setData({
            ok: false,
            error: json?.error || "RESULT_FETCH_FAILED",
            detail: json || { status: res.status },
          });
          return;
        }

        setData(json);
      } catch (e: any) {
        setData({ ok: false, error: "UNEXPECTED_ERROR", detail: String(e?.message ?? e) });
      } finally {
        setLoading(false);
      }
    })();
  }, [attemptId, examId]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>시험 결과</h1>

        <Link
          href="/"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            textDecoration: "none",
            color: "#111827",
            background: "white",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          홈으로
        </Link>
      </div>

      {loading ? (
        <p style={{ marginTop: 16 }}>불러오는 중…</p>
      ) : !data?.ok ? (
        <div style={{ marginTop: 16, padding: 14, border: "1px solid #fecaca", background: "#fff1f2", borderRadius: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>결과 조회 실패</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>error: {data?.error}</div>
          <pre style={{ marginTop: 10, fontSize: 12, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(data?.detail ?? {}, null, 2)}
          </pre>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
            <div style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
              <div style={{ fontSize: 13, opacity: 0.7 }}>응시자ID</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{data.empId ?? "-"}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
                <div style={{ fontSize: 13, opacity: 0.7 }}>점수</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{typeof data.score === "number" ? data.score : "-"}</div>
              </div>
              <div style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
                <div style={{ fontSize: 13, opacity: 0.7 }}>응시일시</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{data.submittedAt ?? "-"}</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>오답</h2>

            {Array.isArray(data.wrongQuestions) && data.wrongQuestions.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {data.wrongQuestions.map((w, i) => (
                  <div key={i} style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>문항 {i + 1}</div>
                    <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{w.question ?? "-"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 14, border: "1px solid #e5e7eb", borderRadius: 12, background: "white" }}>
                오답이 없습니다.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
