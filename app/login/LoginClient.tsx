// app/login/LoginClient.tsx
"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type LoginOk = { ok: true; empId: string; role: string; team?: string | null; redirect?: string };
type LoginFail = { ok: false; error: string; detail?: any };
type LoginResp = LoginOk | LoginFail;

function s(v: any) {
  return String(v ?? "").trim();
}

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = s(sp.get("next")) || ""; // next는 참고만

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!id || !pw) {
      setMsg("아이디/비밀번호를 입력하세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id, pw }),
      });

      const json: LoginResp = await res.json();

      if (!json || (json as any).ok !== true) {
        setMsg((json as any)?.error || "로그인 실패");
        setLoading(false);
        return;
      }

      // ✅ 서버가 내려준 redirect 우선
      const serverRedirect = s((json as any).redirect);

      // ✅ next는 “사용자”만 의미 있게 처리 (관리자 강제 /admin)
      let target = serverRedirect || "/exam";
      if (s((json as any).role) !== "admin" && next) target = next;

      router.replace(target);
    } catch (err: any) {
      setMsg(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="아이디" />
      <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호" type="password" />
      <button disabled={loading} type="submit">{loading ? "로그인 중..." : "로그인"}</button>
      {msg ? <div style={{ color: "crimson", marginTop: 8 }}>{msg}</div> : null}
    </form>
  );
}
