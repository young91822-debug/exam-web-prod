"use client";

import { useEffect, useMemo, useState } from "react";

type Account = {
  emp_id: string;
  name?: string | null;
  login_id?: string | null;
};

type Attempt = {
  attempt_id: number;
  emp_id: string;
  score: number | null;
  submitted_at: string | null;
};

function fmtKST(dt?: string | null) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "-";
  // KST 보기 좋게
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export default function AdminResultsPage() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [empId, setEmpId] = useState<string>("");

  const [attemptLoading, setAttemptLoading] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/results/accounts", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "계정 목록 조회 실패");
      const list = Array.isArray(data?.data) ? data.data : [];
      setAccounts(list);
      // 기본 선택: 첫 계정
      if (!empId && list[0]?.emp_id) setEmpId(String(list[0].emp_id));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function loadAttempts(targetEmpId: string) {
    if (!targetEmpId) return;
    setAttemptLoading(true);
    setError(null);
    setToast(null);
    setSelectedAttemptId(null);

    try {
      const res = await fetch(`/api/admin/results?emp_id=${encodeURIComponent(targetEmpId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "응시내역 조회 실패");
      setAttempts(Array.isArray(data?.data) ? data.data : []);
    } catch (e: any) {
      setError(String(e?.message || e));
      setAttempts([]);
    } finally {
      setAttemptLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (empId) loadAttempts(empId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  const selectedAttempt = useMemo(
    () => attempts.find((a) => a.attempt_id === selectedAttemptId) || null,
    [attempts, selectedAttemptId]
  );

  function downloadWrong() {
    if (!selectedAttemptId) {
      setError("다운로드할 응시건을 선택해줘.");
      return;
    }
    // ✅ 틀린 문제만 CSV 다운로드
    const url = `/api/admin/results/wrong?attempt_id=${selectedAttemptId}`;
    window.location.href = url;
    setToast("✅ 틀린문제 다운로드를 시작했어.");
  }

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>응시현황</h1>
        <button onClick={() => loadAttempts(empId)} style={btn2} disabled={attemptLoading || !empId}>
          새로고침
        </button>
      </div>

      <div style={{ color: "#666", marginBottom: 12 }}>계정별 점수/오답 확인 및 틀린문제 다운로드</div>

      {toast && <div style={okBox}>{toast}</div>}
      {error && <div style={errBox}>{error}</div>}

      {/* 계정 선택 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 800 }}>계정 선택</div>
        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} style={sel}>
            {accounts.map((a) => (
              <option key={a.emp_id} value={a.emp_id}>
                {a.emp_id}
                {a.name ? ` (${a.name})` : a.login_id ? ` (${a.login_id})` : ""}
              </option>
            ))}
          </select>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={downloadWrong} style={btnPrimary} disabled={!selectedAttemptId}>
            틀린문제 다운로드(CSV)
          </button>
        </div>
      </div>

      {/* 응시내역 */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "#fafafa", borderBottom: "1px solid #eee", fontWeight: 800 }}>
          응시 목록 ({attempts.length}건){attemptLoading ? " - 로딩중..." : ""}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff" }}>
                <th style={th}>선택</th>
                <th style={th}>attemptId</th>
                <th style={th}>응시자ID</th>
                <th style={th}>점수</th>
                <th style={th}>응시일시(KST)</th>
              </tr>
            </thead>
            <tbody>
              {attempts.length === 0 ? (
                <tr>
                  <td style={td} colSpan={5}>
                    응시내역이 없습니다.
                  </td>
                </tr>
              ) : (
                attempts.map((a) => {
                  const selected = a.attempt_id === selectedAttemptId;
                  return (
                    <tr
                      key={a.attempt_id}
                      style={{
                        borderTop: "1px solid #eee",
                        background: selected ? "#f5f7ff" : "white",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedAttemptId(a.attempt_id)}
                    >
                      <td style={td}>
                        <input type="radio" checked={selected} readOnly />
                      </td>
                      <td style={td}>{a.attempt_id}</td>
                      <td style={td}>{a.emp_id}</td>
                      <td style={td}>{a.score ?? "-"}</td>
                      <td style={td}>{fmtKST(a.submitted_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 선택한 응시건 요약 */}
      {selectedAttempt && (
        <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>
            선택된 응시건: attemptId {selectedAttempt.attempt_id}
          </div>
          <div style={{ color: "#555" }}>
            응시자: <b>{selectedAttempt.emp_id}</b> / 점수: <b>{selectedAttempt.score ?? "-"}</b> / 응시일시:{" "}
            <b>{fmtKST(selectedAttempt.submitted_at)}</b>
          </div>
          <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
            ※ “틀린문제 다운로드”는 선택한 attemptId 기준으로 **오답만** 내려받습니다.
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};
const btn2: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #eee",
  background: "#fafafa",
  cursor: "pointer",
  fontWeight: 700,
};
const sel: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "white",
  minWidth: 240,
  fontWeight: 700,
};
const th: React.CSSProperties = {
  textAlign: "center",
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  textAlign: "center",
  padding: "10px 12px",
  fontSize: 13,
  verticalAlign: "top",
};
const okBox: React.CSSProperties = {
  padding: 10,
  border: "1px solid #cfe9d6",
  background: "#f3fff6",
  borderRadius: 10,
  marginBottom: 12,
};
const errBox: React.CSSProperties = {
  padding: 12,
  border: "1px solid #f99",
  background: "#fff5f5",
  borderRadius: 10,
  marginBottom: 12,
};
