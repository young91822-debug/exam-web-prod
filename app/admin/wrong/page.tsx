"use client";

import { useEffect, useMemo, useState } from "react";

type WrongItem = {
  attemptId: number;
  submittedAt: string;
  questionId: number;
  question: string;
  choices: string[];
  correctIndex: number;
  userAnswer: number;
  points: number;
};

export default function AdminWrongPage() {
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [empId, setEmpId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<WrongItem[]>([]);

  async function loadEmpIds() {
    try {
      const res = await fetch("/api/admin/emp-ids", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || "계정 목록 불러오기 실패");
      setEmpIds(json.empIds || []);
      if (!empId && json.empIds?.length) setEmpId(json.empIds[0]); // 첫 계정 자동 선택
    } catch (e: any) {
      setErr(e?.message ?? "에러");
    }
  }

  async function loadWrong(targetEmpId?: string) {
    const useEmp = (targetEmpId ?? empId).trim();
    if (!useEmp) return;

    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/wrong-questions?empId=${encodeURIComponent(useEmp)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || "불러오기 실패");
      setItems(json.wrongQuestions || []);
    } catch (e: any) {
      setErr(e?.message ?? "에러");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmpIds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (empId) loadWrong(empId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  const summary = useMemo(() => {
    const map = new Map<number, { count: number; question: string }>();
    for (const w of items) {
      const prev = map.get(w.questionId);
      map.set(w.questionId, { count: (prev?.count || 0) + 1, question: w.question });
    }
    const top10 = Array.from(map.entries())
      .map(([questionId, v]) => ({ questionId, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { total: items.length, top10 };
  }, [items]);

  // ✅ CSV 다운로드(엑셀로 열림)
  function downloadCSV() {
    const header = ["empId", "attemptId", "submittedAt", "questionId", "question", "userAnswer", "correctAnswer", "points"];
    const rows = items.map((w) => [
      empId,
      String(w.attemptId),
      w.submittedAt,
      String(w.questionId),
      String(w.question).replaceAll("\n", " "),
      String((w.userAnswer ?? -1) + 1),
      String((w.correctIndex ?? -1) + 1),
      String(w.points ?? 0),
    ]);

    const csv =
      "\uFEFF" + // BOM (한글 깨짐 방지)
      [header, ...rows]
        .map((r) => r.map((c) => `"${String(c).replaceAll(`"`, `""`)}"`).join(","))
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wrong_${empId || "emp"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>오답 누적 조회 (관리자)</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>계정(사번) 선택</div>
          <select
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            style={{ width: 220, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          >
            {empIds.length === 0 ? (
              <option value="">제출된 계정 없음</option>
            ) : (
              empIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))
            )}
          </select>
        </div>

        <button
          onClick={() => loadWrong(empId)}
          disabled={loading || !empId}
          style={{
            marginTop: 18,
            padding: "9px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          {loading ? "불러오는 중..." : "새로고침"}
        </button>

        <button
          onClick={downloadCSV}
          disabled={!items.length}
          style={{
            marginTop: 18,
            padding: "9px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: items.length ? "#fff" : "#f5f5f5",
            cursor: items.length ? "pointer" : "not-allowed",
            fontWeight: 700,
          }}
        >
          오답 CSV 다운로드
        </button>
      </div>

      {err && <div style={{ marginBottom: 12, color: "crimson", fontWeight: 700 }}>에러: {err}</div>}

      <div style={{ marginBottom: 16, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
        <div style={{ fontWeight: 800 }}>선택 계정: {empId || "-"}</div>
        <div style={{ marginTop: 6, fontWeight: 700 }}>누적 오답 개수: {summary.total}개</div>

        <div style={{ marginTop: 10, fontWeight: 800 }}>자주 틀린 Top 10</div>
        <ol style={{ margin: "8px 0 0 18px" }}>
          {summary.top10.map((t) => (
            <li key={t.questionId} style={{ marginBottom: 4 }}>
              ({t.count}회) {t.question}
            </li>
          ))}
          {summary.top10.length === 0 && <li>데이터 없음</li>}
        </ol>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={th}>attemptId</th>
              <th style={th}>제출시간</th>
              <th style={th}>문항ID</th>
              <th style={th}>문제</th>
              <th style={th}>내답</th>
              <th style={th}>정답</th>
              <th style={th}>배점</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w, idx) => (
              <tr key={`${w.attemptId}-${w.questionId}-${idx}`} style={{ borderTop: "1px solid #eee" }}>
                <td style={td}>{w.attemptId}</td>
                <td style={td}>{new Date(w.submittedAt).toLocaleString()}</td>
                <td style={td}>{w.questionId}</td>
                <td style={{ ...td, whiteSpace: "normal" }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>{w.question}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {Array.isArray(w.choices) &&
                      w.choices.map((c, i) => (
                        <div key={i}>
                          {i + 1}. {c}
                        </div>
                      ))}
                  </div>
                </td>
                <td style={td}>{Number.isFinite(w.userAnswer) ? w.userAnswer + 1 : "-"}</td>
                <td style={td}>{Number.isFinite(w.correctIndex) ? w.correctIndex + 1 : "-"}</td>
                <td style={td}>{w.points ?? 0}</td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td style={td} colSpan={7}>
                  데이터 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, color: "#666", fontSize: 13 }}>※ “내답/정답”은 보기 번호(1~4) 기준</div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid #eee",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  verticalAlign: "top",
  whiteSpace: "nowrap",
};
