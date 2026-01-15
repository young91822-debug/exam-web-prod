// app/login/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function s(v: any) {
  return String(v ?? "").trim();
}

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = useMemo(() => s(sp.get("next")) || "/admin", [sp]);

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");

    const id2 = s(id);
    const pw2 = s(pw);

    if (!id2 || !pw2) {
      setErr("아이디/비밀번호를 입력하세요.");
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: id2, pw: pw2 }), // ✅ 서버가 확실히 읽는 키로 고정
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { ok: false, error: "BAD_JSON", detail: text };
      }

      if (!res.ok || !json?.ok) {
        setErr(json?.error || `HTTP_${res.status}`);
        return;
      }

      // ✅ 성공하면 next로 이동
      router.replace(next);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>로그인</h1>

      <form onSubmit={onSubmit}>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="아이디"
            autoComplete="username"
            style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호"
            type="password"
            autoComplete="current-password"
            style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button
            type="submit"
            style={{
              padding: 12,
              borderRadius: 10,
              border: "none",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            로그인
          </button>

          {err ? (
            <div style={{ color: "#d00", fontWeight: 700 }}>
              로그인 실패: {err}
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
