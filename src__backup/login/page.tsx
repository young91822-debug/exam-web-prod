// app/login/page.tsx  (또는 src/app/login/page.tsx)
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/admin";

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const form = e.currentTarget;
    const fd = new FormData(form);

    const id = String(fd.get("id") ?? "").trim();
    const password = String(fd.get("password") ?? "").trim();

    if (!id || !password) {
      setError("아이디/비밀번호 필요");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });

      // JSON/텍스트 모두 안전 처리
      const text = await res.text();
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!res.ok) {
        setError(payload?.error || "로그인 실패");
        return;
      }

      router.replace(next);
    } catch (err: any) {
      setError(err?.message || "네트워크 오류");
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
          name="id"
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
        />

        <input
          name="password"
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
        />

        {error ? (
          <div style={{ color: "#d32f2f", fontWeight: 900, margin: "6px 0 12px" }}>{error}</div>
        ) : (
          <div style={{ height: 24 }} />
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 12,
            border: "none",
            background: loading ? "#374151" : "#111827",
            color: "#fff",
            fontSize: 15,
            fontWeight: 900,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
