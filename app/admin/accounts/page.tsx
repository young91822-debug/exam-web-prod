"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  user_id: string;
  password: string;
  created_at: string;
};

export default function AdminAccountsPage() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/accounts", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "조회 실패");
      setRows(json?.data || []);
    } catch (e: any) {
      setRows([]);
      setMsg(e?.message || "오류");
    } finally {
      setLoading(false);
    }
  }

  async function createAccount() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "생성 실패");

      setUserId("");
      setPassword("");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "오류");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("삭제할까?")) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/accounts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "삭제 실패");
      await load();
    } catch (e: any) {
      setMsg(e?.message || "오류");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>계정관리</h1>

      {msg && <div style={{ color: "crimson", marginBottom: 10, whiteSpace: "pre-wrap" }}>{msg}</div>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input placeholder="아이디" value={userId} onChange={(e) => setUserId(e.target.value)} style={input} />
        <input placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
        <button onClick={createAccount} disabled={loading} style={btn}>
          계정 생성
        </button>
        <button onClick={load} disabled={loading} style={btn2}>
          새로고침
        </button>
      </div>

      means: 총 {rows.length}건

      <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={th}>아이디</th>
              <th style={th}>비밀번호</th>
              <th style={th}>생성일</th>
              <th style={th}>삭제</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 16, color: "#666" }}>
                  계정이 없어. 위에서 생성해줘.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={td}>{r.user_id}</td>
                  <td style={td}>{r.password}</td>
                  <td style={td}>{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</td>
                  <td style={td}>
                    <button onClick={() => remove(r.id)} disabled={loading} style={danger}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  outline: "none",
  width: 240,
};

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btn2: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 12,
  fontSize: 13,
  color: "#333",
};

const td: React.CSSProperties = {
  padding: 12,
  fontSize: 13,
};

const danger: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #b91c1c",
  background: "#b91c1c",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
