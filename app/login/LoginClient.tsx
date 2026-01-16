"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ---------- 타입 ---------- */
type LoginOk = {
  ok: true;
  empId: string;
  role: string;
  name?: string;
  redirect?: string;
};

type LoginFail = {
  ok: false;
  error: string;
};

type LoginResp = LoginOk | LoginFail;

/* ---------- utils ---------- */
function s(v: any) {
  return String(v ?? "").trim();
}

function safePath(p: string) {
  const x = s(p);
  // 외부 URL 차단 + 공백 제거
  if (!x) return "";
  if (x.startsWith("http://") || x.startsWith("https://")) return "";
  if (!x.startsWith("/")) return "";
  return x;
}

function isAdminPath(p: string) {
  const x = safePath(p);
  return x === "/admin" || x.startsWith("/admin/");
}

/* ---------- component ---------- */
export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextRaw = s(sp.get("next"));
  const next = safePath(nextRaw);

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const id2 = s(id);
    const pw2 = s(pw);

    if (!id2 || !pw2) {
      setMsg("아이디/비밀번호를 입력하세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: id2, pw: pw2 }),
      });

      const text = await res.text();
      const json: LoginResp = text
        ? JSON.parse(text)
        : ({ ok: false, error: "EMPTY_RESPONSE" } as LoginFail);

      if (!res.ok || !json.ok) {
        const errCode = (json as LoginFail)?.error || `HTTP_${res.status}`;

        setMsg(
          errCode === "MISSING_FIELDS"
            ? "아이디/비밀번호를 입력하세요."
            : errCode === "USER_NOT_FOUND"
            ? "계정이 없습니다."
            : errCode === "PASSWORD_NOT_SET"
            ? "비밀번호가 설정되지 않았습니다."
            : errCode === "USER_INACTIVE" || errCode === "INACTIVE_ACCOUNT"
            ? "비활성 계정입니다."
            : "로그인 실패: 아이디/비밀번호를 확인하세요."
        );
        return;
      }

      // ✅ 성공
      const ok = json as LoginOk;
      const role = s(ok.role);

      // 서버가 주는 redirect(있으면)도 안전하게
      const apiRedirect = safePath(ok.redirect || "");

      // ✅ 관리자 리다이렉트 규칙:
      // - next가 /admin... 이면 next로
      // - 아니면 무조건 /admin
      // (apiRedirect는 "명시적으로 서버가 준 것"이라 admin이면 admin쪽만 허용)
      let redirect = "";
      if (role === "admin") {
        if (isAdminPath(next)) redirect = next;
        else if (isAdminPath(apiRedirect)) redirect = apiRedirect;
        else redirect = "/admin";
      } else {
        // ✅ 일반 사용자:
        // - apiRedirect 있으면 그거
        // - next 있으면 그거
        // - 없으면 /exam
        redirect = apiRedirect || next || "/exam";
      }

      router.replace(redirect);
      router.refresh();
    } catch (err: any) {
      setMsg(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">로그인</h1>

        <div className="space-y-2">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="아이디"
            className="w-full border rounded px-3 py-2"
            autoComplete="username"
          />
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type="password"
            placeholder="비밀번호"
            className="w-full border rounded px-3 py-2"
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded px-3 py-2 border bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>

        {msg && <div className="text-sm text-red-600">{msg}</div>}
      </form>
    </div>
  );
}
