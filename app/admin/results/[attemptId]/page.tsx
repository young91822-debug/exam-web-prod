"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type DetailResp =
  | {
      ok: true;
      attempt: {
        id: any;
        emp_id: string | null;
        team: string | null;
        status: string | null;
        score: number;
        total_questions: number;
        started_at: any;
        submitted_at: any;
      };
      wrongItems: {
        questionId: string | null;
        content: string;
        choices: string[];
        selectedIndex: number | null;
        correctIndex: number | null;
        points: number;
        isWrong: boolean;
      }[];
      meta?: any;
    }
  | { ok: false; error: string; detail?: any };

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function pill(text: string) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        background: "#f3f4f6",
        color: "#111827",
        border: "1px solid #e5e7eb",
      }}
    >
      {text}
    </span>
  );
}

export default function AdminResultDetailPage() {
  const router = useRouter();
  const params = useParams() as any;
  const attemptId = useMemo(() => String(params?.attemptId ?? ""), [params]);

  const apiUrl = useMemo(() => `/api/admin/result-detail?attemptId=${encodeURIComponent(attemptId)}`, [attemptId]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailResp | null>(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      const res = await fetch(apiUrl, { cache: "no-store" });
      const json: DetailResp = await res.json().catch(() => ({} as any));
      if (!alive) return;
      setData(json);
      setLoading(false);
    }
    run();
    return () => {
      alive = false;
    };
  }, [apiUrl]);

  if (loading) return <div style={{ padding: 20 }}>로딩중...</div>;

  if (!data || (data as any).ok !== true) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>에러</div>
        <pre style={{ background: "#111827", color: "white", padding: 14, borderRadius: 12, overflow: "auto" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
        <button
          onClick={() => router.push("/admin/results")}
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          목록으로
        </button>
      </div>
    );
  }

  const ok = data as Extract<DetailResp, { ok: true }>;
  const a = ok.attempt;

  const wrong = ok.wrongItems ?? [];
  const wrongCount = wrong.length;

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950 }}>결과 상세</div>
          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pill(`attemptId: ${a.id}`)}
            {pill(`응시자: ${a.emp_id ?? "-"}`)}
            {pill(`팀: ${a.team ?? "-"}`)}
            {pill(`상태: ${a.status ?? "-"}`)}
          </div>
        </div>

        <button
          onClick={() => router.push("/admin/results")}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          ← 목록
        </button>
      </div>

      {/* 요약 카드 */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {[
          { label: "점수", value: `${a.score} / ${a.total_questions}` },
          { label: "오답", value: `${wrongCount}개` },
          { label: "시작", value: fmt(a.started_at) },
          { label: "제출", value: fmt(a.submitted_at) },
        ].map((x) => (
          <div
            key={x.label}
            style={{
              padding: 14,
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              background: "white",
              boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.65, fontWeight: 800 }}>{x.label}</div>
            <div style={{ marginTop: 6, fontSize: 16, fontWeight: 950 }}>{x.value}</div>
          </div>
        ))}
      </div>

      {/* 오답 리스트 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 10 }}>틀린 문제</div>

        {wrongCount === 0 ? (
          <div
            style={{
              padding: 14,
              border: "1px dashed #d1d5db",
              borderRadius: 16,
              background: "#fafafa",
              color: "#374151",
              fontWeight: 800,
            }}
          >
            오답이 없거나(만점), 오답 데이터를 아직 저장하지 않는 구조일 수 있어요.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {wrong.map((w, idx) => (
              <div
                key={`${w.questionId ?? "q"}-${idx}`}
                style={{
                  padding: 14,
                  border: "1px solid #e5e7eb",
                  borderRadius: 16,
                  background: "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 950 }}>
                    Q{idx + 1}. {w.content}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>points: {w.points}</div>
                </div>

                {w.choices?.length ? (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {w.choices.map((c, i) => {
                      const isCorrect = w.correctIndex === i;
                      const isSelected = w.selectedIndex === i;

                      return (
                        <div
                          key={i}
                          style={{
                            padding: 10,
                            borderRadius: 12,
                            border: "1px solid #e5e7eb",
                            background: isCorrect ? "#ecfdf5" : isSelected ? "#fff7ed" : "#fafafa",
                            fontWeight: 800,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <div>
                              <span style={{ opacity: 0.7, marginRight: 6 }}>{i + 1}.</span>
                              {c}
                            </div>
                            <div style={{ fontSize: 12 }}>
                              {isCorrect ? "정답" : isSelected ? "내 선택" : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ marginTop: 10, opacity: 0.7 }}>
                    보기 데이터가 없는 유형(주관식 등)일 수 있어요.
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, fontWeight: 800 }}>
                  선택: {w.selectedIndex === null ? "-" : w.selectedIndex + 1} / 정답:{" "}
                  {w.correctIndex === null ? "-" : w.correctIndex + 1}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
