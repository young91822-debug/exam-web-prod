// app/exam/result/[attemptId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type ApiResp = any;

function s(v: any) {
  return String(v ?? "").trim();
}

function fmt(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("ko-KR");
}

function pct(score: number, total: number) {
  if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((score / total) * 100);
}

export default function ExamResultPage() {
  const router = useRouter();
  const params = useParams();
  const attemptId = s((params as any)?.attemptId);

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

  const attempt = data?.attempt ?? {};
  const graded: any[] = Array.isArray(data?.graded) ? data.graded : [];

  const score = Number(attempt?.score ?? 0);
  const totalPoints = Number(
    data?.totalPoints ??
      attempt?.total_points ??
      graded.reduce((acc, g) => acc + Number(g?.points ?? 0), 0)
  );
  const totalQuestions = Number(attempt?.total_questions ?? graded.length ?? 0);
  const wrongCount = Number(data?.wrongCount ?? graded.filter((g) => g?.isCorrect === false).length ?? 0);
  const correctCount = Math.max(0, totalQuestions - wrongCount);

  const percent = useMemo(() => pct(score, totalPoints), [score, totalPoints]);

  // ✅ 응시자용: 정답/선택지/내선택 번호는 숨김. 문항별로는 "정답/오답"만 선택적으로 보여줌
  // 필요하면 true로 바꾸면 "문항별 정오표"만 짧게 표시됨(정답/선택지 없음)
  const SHOW_QUESTION_SUMMARY = true;

  if (loading) return <div className="p-6">불러오는 중…</div>;

  if (err) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-red-600 font-semibold">결과를 불러오지 못했습니다.</div>
        <div className="text-sm text-gray-600">에러: {err}</div>
        <button
          className="px-3 py-2 rounded border"
          onClick={() => router.refresh()}
        >
          새로고침
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">시험 결과</h1>
          <div className="text-sm text-gray-500">제출이 완료되었습니다.</div>
        </div>
        <a className="px-3 py-2 rounded border text-sm" href="/exam">
          다시 시험 보기
        </a>
      </div>

      {/* 요약 카드 */}
      <div className="border rounded-xl p-5 space-y-4 bg-white">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">요약</div>
          <div className="text-sm text-gray-500">{percent}%</div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="text-gray-600">점수</div>
          <div className="font-semibold">
            {score} / {totalPoints}
          </div>

          <div className="text-gray-600">정답</div>
          <div className="font-semibold">{correctCount} / {totalQuestions}</div>

          <div className="text-gray-600">응시 시작</div>
          <div>{fmt(attempt?.started_at)}</div>

          <div className="text-gray-600">제출 시각</div>
          <div>{fmt(attempt?.submitted_at)}</div>
        </div>

        {/* 안내 문구 */}
        <div className="text-xs text-gray-500">
          * 상세 정답/해설은 표시하지 않습니다.
        </div>
      </div>

      {/* 문항별 정오표(옵션) */}
      {SHOW_QUESTION_SUMMARY && graded.length > 0 && (
        <div className="border rounded-xl p-5 bg-white space-y-3">
          <div className="font-semibold">문항별 결과</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {graded.map((g, idx) => {
              const ok = !!g?.isCorrect;
              return (
                <div
                  key={String(g?.questionId ?? idx)}
                  className={[
                    "rounded-lg border px-3 py-2 text-sm flex items-center justify-between",
                    ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50",
                  ].join(" ")}
                >
                  <span className="font-semibold">Q{idx + 1}</span>
                  <span className={ok ? "text-green-700" : "text-red-700"}>
                    {ok ? "정답" : "오답"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* graded가 비어있을 때(응시자용: 디버그 JSON 숨김) */}
      {graded.length === 0 && (
        <div className="text-sm text-gray-600">
          표시할 상세 결과가 없습니다.
        </div>
      )}

      {/* 하단 버튼 */}
      <div className="flex gap-2">
        <a className="px-3 py-2 rounded border text-sm" href="/exam">
          시험으로 돌아가기
        </a>
        <button className="px-3 py-2 rounded border text-sm" onClick={() => window.print()}>
          인쇄
        </button>
      </div>

      {/* 내부용 attemptId는 숨김 처리(필요하면 주석 해제) */}
      {/* <div className="text-xs text-gray-400">attemptId: {attemptId}</div> */}
    </div>
  );
}
