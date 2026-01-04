// app/login/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const sp = useSearchParams();

  const nextPath = useMemo(() => {
    const n = sp.get("next") || "";
    // 보안상 외부 URL 방지
    if (!n) return "";
    if (n.startsWith("http")) return "";
    return n;
  }, [sp]);

  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!id.trim() || !password.trim()) {
      setMsg("아이디/비밀번호 필요");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id.trim(), password: password.trim() }),
      });

      const text = await res.text();
      let json: any = null;

      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("서버가 JSON이 아닌 응답(HTML)을 반환했습니다. middleware/경로 문제일 가능성이 큽니다.");
      }

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `로그인 실패 (status ${res.status})`);
      }

      const role = json.role as "admin" | "user";
      const dest = role === "admin" ? (nextPath || "/admin") : "/exam";

      window.location.replace(dest);
    } catch (err: any) {
      setMsg(err?.message || "로그인 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fafafa" }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: 420,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 28,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>로그인</h1>

        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="아이디"
          autoComplete="username"
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            fontSize: 14,
            marginBottom: 10,
          }}
          name="id"
        />

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            fontSize: 14,
            marginBottom: 10,
          }}
          name="password"
        />

        <div style={{ height: 24, color: "#dc2626", fontSize: 13, fontWeight: 700 }}>
          {msg}
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 12,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontSize: 15,
            fontWeight: 900,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
