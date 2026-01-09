"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
        credentials: "include",
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        setMsg("로그인 실패: 아이디/비밀번호를 확인하세요.");
        setLoading(false);
        return;
      }

      // ✅ admin이면 관리자 페이지로 이동
      if (j.role === "admin" || j.empId === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/exam");
      }
    } catch {
      setMsg("로그인 오류: 서버 상태를 확인하세요.");
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
            cursor: "pointer",
            fontWeight: 800,
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
