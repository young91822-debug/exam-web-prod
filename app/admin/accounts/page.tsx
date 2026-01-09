"use client";

import { useEffect, useMemo, useState } from "react";

type Account = {
  id: number;
  emp_id: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
};

export default function AdminAccountsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Account[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // form
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const canCreate = useMemo(() => empId.trim().length > 0, [empId]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/accounts", { method: "GET" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.detail || j?.error || `LOAD_FAILED (${res.status})`);
      }
      setRows(j.rows || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate() {
    setErr(null);
    setOkMsg(null);

    const payload = {
      empId: empId.trim(),
      name: name.trim() || null,
      isActive,
    };

    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ✅ 버튼 눌렀는데 “반응이 없다” 방지: body 반드시 넣기
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.detail || j?.error || `CREATE_FAILED (${res.status})`);
      }

      setOkMsg(`생성 완료: ${j.emp_id}`);
      setEmpId("");
      setName("");
      setIsActive(true);

      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function onToggle(row: Account) {
    setErr(null);
    setOkMsg(null);

    try {
      const res = await fetch("/api/admin/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, isActive: !row.is_active }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.detail || j?.error || `UPDATE_FAILED (${res.status})`);
      }
      setOkMsg(`변경 완료: ${row.emp_id}`);
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>응시자 계정 관리</h1>

      {/* 메시지 */}
      {err && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #fecaca", background: "#fff1f2", borderRadius: 12 }}>
          <b>에러</b>: {err}
        </div>
      )}
      {okMsg && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 12 }}>
          {okMsg}
        </div>
      )}

      {/* 생성 폼 */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "#6b7280" }}>응시자ID(emp_id) *</label>
            <input
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="예: 201978"
              style={{ width: 220, padding: "10px 12px", borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "#6b7280" }}>이름(선택)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              style={{ width: 220, padding: "10px 12px", borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "#6b7280" }}>사용 여부</label>
            <select
              value={isActive ? "Y" : "N"}
              onChange={(e) => setIsActive(e.target.value === "Y")}
              style={{ width: 160, padding: "10px 12px", borderRadius: 12, border: "1px solid #e5e7eb" }}
            >
              <option value="Y">사용</option>
              <option value="N">미사용</option>
            </select>
          </div>

          {/* ✅ submit 이슈 방지: type="button" */}
          <button
            type="button"
            onClick={onCreate}
            disabled={!canCreate}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #111827",
              background: canCreate ? "#111827" : "#9ca3af",
              color: "white",
              fontWeight: 800,
              cursor: canCreate ? "pointer" : "not-allowed",
            }}
          >
            생성
          </button>

          <button
            type="button"
            onClick={load}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "white",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            새로고침
          </button>
        </div>

        <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12 }}>
          * “생성” 눌렀는데 아무 반응 없으면: 브라우저 개발자도구 → Network에서 <b>/api/admin/accounts</b> POST가 찍히는지 확인
        </div>
      </div>

      {/* 목록 */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>
            목록 {loading ? "(로딩중...)" : `(${rows.length}건)`}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>ID</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>emp_id</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>이름</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>사용</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>생성일</th>
                <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 14, color: "#6b7280" }}>
                    아직 계정이 없습니다.
                  </td>
                </tr>
              )}

              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.id}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", fontWeight: 800 }}>{r.emp_id}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.name || "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.is_active ? "사용" : "미사용"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                    <button
                      type="button"
                      onClick={() => onToggle(r)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #e5e7eb",
                        background: "white",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {r.is_active ? "미사용으로" : "사용으로"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
