// app/exam/result/[attemptId]/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ApiResp = any;

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export default function ExamResultPage() {
  const params = useParams();
  const attemptId = String((params as any)?.attemptId ?? "");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<ApiResp | null>(null);

  useEffect(() => {
    let dead = false;

    (async () => {
      try {
        setLoading(true);
        setErr("");

        const res = await fetch(`/api/result/${attemptId}`, { cache: "no-store" });
        const txt = await res.text();
        const json = txt ? JSON.parse(txt) : null;

        if (dead) return;

        if (!res.ok || !json?.ok) {
          setErr(json?.error || `HTTP_${res.status}`);
          setData(json);
        } else {
          setData(json);
        }
      } catch (e: any) {
        if (!dead) setErr(String(e?.message ?? e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();

    return () => {
      dead = true;
    };
  }, [attemptId]);

  if (loading) return <div className="p-6">불러오는 중…</div>;
  if (err) return <div className="p-6 text-red-600">에러: {err}</div>;

  const attempt = data?.attempt ?? {};
  const graded: any[] = Array.isArray(data?.graded) ? data.graded : [];

  const score = Number(attempt?.score ?? 0);
  const totalPoints = Number(
    data?.totalPoints ??
      attempt?.total_points ??
      graded.reduce((acc, g) => acc + Number(g?.points ?? 0), 0)
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">시험 결과</h1>
          <div className="text-sm text-gray-500">attemptId: {attemptId}</div>
        </div>
        <a
          className="px-3 py-2 rounded border"
          href="/exam"
        >
          다시 시험 보기
        </a>
      </div>

      {/* 요약 */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-semibold">요약</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-gray-600">점수</div>
          <div className="font-semibold">
            {score} / {totalPoints}
          </div>

          <div className="text-gray-600">응시 시작</div>
          <div>{fmt(attempt?.started_at)}</div>

          <div className="text-gray-600">제출 시각</div>
          <div>{fmt(attempt?.submitted_at)}</div>
        </div>
      </div>

      {/* 상세 */}
      {graded.length === 0 ? (
        <div className="text-sm text-gray-600">
          표시할 상세 결과가 없습니다. (graded가 비어있음)
          <pre className="mt-2 text-xs bg-gray-50 p-3 rounded overflow-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="space-y-6">
          {graded.map((g, idx) => {
            const qNo = idx + 1;
            const selected = g?.selectedIndex;
            const correct = g?.correctIndex;

            return (
              <div key={String(g?.questionId ?? idx)} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    Q{qNo}. {g?.content}
                  </div>
                  <div className={`text-sm ${g?.isCorrect ? "text-green-600" : "text-red-600"}`}>
                    {g?.isCorrect ? "정답" : "오답"}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {(g?.choices ?? []).map((c: string, i: number) => {
                    const isMine = selected === i;
                    const isAns = correct === i;
                    return (
                      <div
                        key={i}
                        className={[
                          "p-2 rounded border text-sm",
                          isAns ? "border-green-500" : "border-gray-200",
                          isMine ? "bg-blue-50" : "",
                        ].join(" ")}
                      >
                        {i + 1}. {c}
                        <span className="ml-2 text-xs text-gray-500">
                          {isAns ? "정답" : ""}
                          {isMine ? (isAns ? " / 내 선택" : "내 선택") : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 text-sm">
                  <div>내 선택: {selected === null || selected === undefined ? "-" : selected + 1}</div>
                  <div>정답: {correct === null || correct === undefined ? "-" : correct + 1}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
