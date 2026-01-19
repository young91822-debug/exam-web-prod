"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type GradedItem = {
  questionId: string | null;
  content: string;
  choices: string[];
  selectedIndex: number | null;
  correctIndex: number | null;
  status?: string | null;
  isCorrect?: boolean | null;
};

type WrongItem = {
  questionId: string | null;
  content: string;
  choices: string[];
  selectedIndex: number | null;
  correctIndex: number | null;
  points: number;
  isWrong: boolean;
};

type DetailResp =
  | {
      ok: true;

      // ✅ attempt는 snake/camel 둘 다 들어올 수 있음
      attempt: any;

      // ✅ 예전 포맷
      wrongItems?: WrongItem[];

      // ✅ 최신 포맷(너 네트워크에서 보이던)
      graded?: GradedItem[];

      meta?: any;
    }
  | { ok: false; error: string; detail?: any };

function s(v: any) {
  return String(v ?? "").trim();
}
function n(v: any, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
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

  const apiUrl = useMemo(
    () => `/api/admin/result-detail?attemptId=${encodeURIComponent(attemptId)}`,
    [attemptId]
  );

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
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>
          에러
        </div>
        <pre
          style={{
            background: "#111827",
            color: "white",
            padding: 14,
            borderRadius: 12,
            overflow: "auto",
          }}
        >
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
  const a = ok.attempt ?? {};

  // ✅ attempt 필드 snake/camel 둘 다 대응
  const attempt = {
    id: a.id ?? a.attemptId ?? a.attempt_id ?? "-",
    emp_id: a.emp_id ?? a.empId ?? null,
    team: a.team ?? null,
    status: a.status ?? null,
    started_at: a.started_at ?? a.startedAt ?? null,
    submitted_at: a.submitted_at ?? a.submittedAt ?? null,

    // 점수계산용
    score: n(a.score, 0),
    total_points: n(a.total_points ?? a.totalPoints, 0),
    total_questions: n(a.total_questions ?? a.totalQuestions, 0),
    wrong_count: n(a.wrong_count ?? a.wrongCount, 0),
  };

  // ✅ wrongItems가 있으면 우선 사용
  // ✅ 없으면 graded로부터 틀린 문항만 만들어서 보여줌
  const wrongFromApi: WrongItem[] = Array.isArray(ok.wrongItems) ? ok.wrongItems : [];

  const graded: GradedItem[] = Array.isArray((ok as any).graded) ? (ok as any).graded : [];

  const wrongFromGraded: WrongItem[] = graded
    .filter((g) => {
      // selected가 없으면 오답으로 보지 않음(미응답)
      if (g.selectedIndex === null || g.selectedIndex === undefined) return false;
      // correctIndex 없으면 채점 불가 → 오답 목록에서 제외
      if (g.correctIndex === null || g.correctIndex === undefined) return false;
      return Number(g.selectedIndex) !== Number(g.correctIndex);
    })
    .map((g) => ({
      questionId: g.questionId ?? null,
      content: g.content ?? "",
      choices: Array.isArray(g.choices) ? g.choices : [],
      selectedIndex: g.selectedIndex ?? null,
      correctIndex: g.correctIndex ?? null,
      points: 0, // points는 questions에서 안 내려오면 0
      isWrong: true,
    }));

  const wrong: WrongItem[] = wrongFromApi.length ? wrongFromApi : wrongFromGraded;
  const wrongCount = wrong.length;

  // ✅ 점수 표시 로직
  // - total_points 있으면: score/total_points + (100점 환산)
  // - 없으면: score만 표시
  const totalPts = attempt.total_points;
  const percent = totalPts > 0 ? Math.round((attempt.score / totalPts) * 100) : null;

  const scoreLabel =
    totalPts > 0
      ? `${attempt.score} / ${totalPts} (${percent}점)`
      : `${attempt.score}`;

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 950 }}>결과 상세</div>
          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pill(`attemptId: ${attempt.id}`)}
            {pill(`응시자: ${attempt.emp_id ?? "-"}`)}
            {pill(`팀: ${attempt.team ?? "-"}`)}
            {pill(`상태: ${attempt.status ?? "-"}`)}
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
          { label: "점수", value: scoreLabel },
          { label: "오답", value: `${wrongCount}개` },
          { label: "시작", value: fmt(attempt.started_at) },
          { label: "제출", value: fmt(attempt.submitted_at) },
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
            오답이 없거나(만점), 답안/정답 비교 데이터(graded)가 비어있어요.
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
                  <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>
                    {w.points ? `points: ${w.points}` : ""}
                  </div>
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
                  <div style={{ marginTop: 10, opacity: 0.7 }}>보기 데이터가 없는 유형(주관식 등)일 수 있어요.</div>
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
