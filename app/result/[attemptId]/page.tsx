"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type ApiOk = {
  ok: true;
  attempt: any;
  graded?: any[];
  wrongQuestions?: any[];
  wrongCount?: number;
  totalQuestions?: number;
  meta?: any;
};

type ApiErr = { ok: false; error: string; detail?: any };

type ApiResp = ApiOk | ApiErr;

function fmtDate(v: any) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function pick<T = any>(obj: any, keys: string[], fallback: any = undefined): T {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return fallback as T;
}

/** 숫자(0 포함) 안전 파서 */
function toNum(v: any): number | null {
  if (v === 0) return 0;
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** 여러 후보 키 중 숫자 값을 하나 골라오기 */
function pickNum(obj: any, keys: string[], fallback: number | null = null): number | null {
  for (const k of keys) {
    const x = toNum(obj?.[k]);
    if (x !== null) return x;
  }
  return fallback;
}

export default function AdminResultDetailPage() {
  const router = useRouter();
  const params = useParams();

  const attemptId = useMemo(() => {
    const raw =
      (params as any)?.attemptId ??
      (params as any)?.attemptID ??
      (params as any)?.id;
    return String(raw ?? "").trim();
  }, [params]);

  const apiUrl = useMemo(
    () => `/api/admin/result-detail?attemptId=${encodeURIComponent(attemptId)}`,
    [attemptId]
  );

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<ApiOk | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");

    (async () => {
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const json: ApiResp = await res
          .json()
          .catch(() => ({ ok: false, error: "BAD_JSON" } as any));

        if (!alive) return;

        if (!json?.ok) {
          setErr((json as ApiErr)?.error || `HTTP_${res.status}`);
          setData(null);
          setLoading(false);
          return;
        }

        setData(json as ApiOk);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message ?? e));
        setData(null);
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [apiUrl]);

  const attempt = data?.attempt ?? null;
  const graded = Array.isArray(data?.graded) ? (data!.graded as any[]) : [];
  const wrongQuestions = Array.isArray(data?.wrongQuestions)
    ? (data!.wrongQuestions as any[])
    : [];

  // ✅ 총문항/오답/점수는 "어떤 키로 오든" 잡아냄
  const totalQuestions = useMemo(() => {
    const fromTop = pick<number>(data, ["totalQuestions", "total_questions"], null);
    const fromAttempt = pick<number>(attempt, ["total_questions", "totalQuestions"], null);
    return fromTop ?? fromAttempt ?? graded.length ?? 0;
  }, [data, attempt, graded.length]);

  const wrongCount = useMemo(() => {
    const fromTop = pick<number>(data, ["wrongCount", "wrong_count"], null);
    return fromTop ?? wrongQuestions.length ?? 0;
  }, [data, wrongQuestions.length]);

  const score = useMemo(() => {
    return pick<number>(attempt, ["score", "total_score", "result_score"], 0) ?? 0;
  }, [attempt]);

  const empId = useMemo(() => {
    return (
      pick<string>(
        attempt,
        ["emp_id", "empId", "user_id", "userId", "account_id", "accountId"],
        "-"
      ) ?? "-"
    );
  }, [attempt]);

  const startedAt = useMemo(
    () => pick<any>(attempt, ["started_at", "startedAt", "created_at", "createdAt"], null),
    [attempt]
  );
  const submittedAt = useMemo(
    () =>
      pick<any>(
        attempt,
        ["submitted_at", "submittedAt", "ended_at", "endedAt", "completed_at", "completedAt"],
        null
      ),
    [attempt]
  );

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => router.back()} style={{ marginBottom: 12 }}>
          ← 뒤로
        </button>
        <h2 style={{ margin: "8px 0 12px" }}>응시 상세</h2>
        <div>로딩 중...</div>
        <div style={{ opacity: 0.7, marginTop: 8 }}>{apiUrl}</div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => router.back()} style={{ marginBottom: 12 }}>
          ← 뒤로
        </button>
        <h2 style={{ margin: "8px 0 12px" }}>응시 상세</h2>

        <div style={{ fontWeight: 700, color: "crimson" }}>상세 로딩 실패</div>
        <pre style={{ background: "#111", color: "#fff", padding: 12, borderRadius: 8, overflow: "auto" }}>
          {JSON.stringify({ ok: false, error: err }, null, 2)}
        </pre>

        <div style={{ opacity: 0.7, marginTop: 8 }}>{apiUrl}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <button onClick={() => router.back()} style={{ marginBottom: 12 }}>
        ← 뒤로
      </button>

      <h2 style={{ margin: "8px 0 12px" }}>응시 상세</h2>

      <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 8 }}>
        attemptId: {attemptId}
        <br />
        apiUrl: {apiUrl}
      </div>

      {/* 기본 정보 */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>기본 정보</div>
        <div>응시자ID: {empId}</div>
        <div>점수: {score}</div>
        <div>응시일시: {submittedAt ? fmtDate(submittedAt) : fmtDate(startedAt)}</div>
        <div style={{ marginTop: 6 }}>
          오답: {wrongCount}개 / 총 문항: {totalQuestions}개
        </div>
      </div>

      {/* 틀린 문항 */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>틀린 문항</div>

        {wrongQuestions.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            {pick(attempt, ["submitted_at"], null) ? "오답이 없습니다." : "아직 제출 전이거나 오답 데이터가 없습니다."}
          </div>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {wrongQuestions.map((w: any, idx: number) => {
              // ✅ 여기서 “중간중간 내 선택/정답 -” 되는 거 방지
              const selected0 = pickNum(w, [
                "selectedIndex",
                "selected_index",
                "chosenIndex",
                "chosen_index",
                "answerIndex",
                "answer_index",
              ]);
              const correct0 = pickNum(w, [
                "correctIndex",
                "correct_index",
                "correctAnswerIndex",
                "correct_answer_index",
                "answerIndex",
                "answer_index",
              ]);

              // 화면엔 1~4로 표시 (0-based → 1-based)
              const selectedText = selected0 === null ? "-" : String(selected0 + 1);
              const correctText = correct0 === null ? "-" : String(correct0 + 1);

              return (
                <li key={String(w?.id ?? w?.questionId ?? idx)} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600 }}>{w?.content ?? w?.question ?? w?.title ?? "-"}</div>
                  <div style={{ opacity: 0.85, fontSize: 13 }}>
                    내 선택: {selectedText} / 정답: {correctText}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* 전체 graded */}
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 8 }}>
          전체 채점 데이터(graded) 보기
        </summary>
        <pre style={{ background: "#111", color: "#fff", padding: 12, borderRadius: 8, overflow: "auto" }}>
          {JSON.stringify(graded, null, 2)}
        </pre>
      </details>

      {/* meta */}
      {data?.meta ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>meta 보기</summary>
          <pre style={{ background: "#111", color: "#fff", padding: 12, borderRadius: 8, overflow: "auto" }}>
            {JSON.stringify(data.meta, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
