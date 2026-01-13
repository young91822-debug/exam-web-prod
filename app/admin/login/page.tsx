"use client";

import { useState } from "react";

export default function LoginPage() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setMsg(null);
    setLoading(true);

    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
  id: loginId,
  pw: password,
}),
        credentials: "include",
        cache: "no-store",
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        setMsg("로그인 실패: 아이디/비밀번호를 확인하세요.");
        return;
      }

      // ✅ role 기준으로만 분기 (admin_gs 같은 계정도 자동 admin)
      const target = j.role === "admin" ? "/admin" : "/exam";

      // ✅ 쿠키 반영 확실한 강제 이동
      window.location.href = target;
    } catch (err) {
      setMsg("로그인 오류: 서버 상태를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>
        로그인
      </h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="아이디"
          autoComplete="username"
          style={{
            width: "100%",
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 10,
            outline: "none",
          }}
        />

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          type="password"
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 10,
            outline: "none",
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 12,
            borderRadius: 10,
            border: 0,
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 800,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        {msg ? (
          <div style={{ color: "crimson", fontSize: 13, marginTop: 6 }}>
            {msg}
          </div>
        ) : null}
      </form>
    </div>
  );
}
