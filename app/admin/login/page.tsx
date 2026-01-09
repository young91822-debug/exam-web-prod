"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const sp = useSearchParams();

  const nextPath = useMemo(() => {
    const n = sp?.get("next");
    if (!n) return "/exam";
    if (!n.startsWith("/")) return "/exam";
    if (n.startsWith("//")) return "/exam";
    return n;
  }, [sp]);

  const err = sp?.get("err") || "";

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ width: 360, border: "1px solid #e5e7eb", borderRadius: 14, padding: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>로그인</h1>

        {err && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c" }}>
            {err === "invalid" ? "아이디 또는 비밀번호가 올바르지 않습니다." :
             err === "required" ? "아이디/비밀번호를 입력해 주세요." :
             err === "db" ? "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." :
             "로그인에 실패했습니다."}
          </div>
        )}

        {/* ✅ fetch 없이 브라우저가 직접 POST */}
        <form
          method="POST"
          action={`/api/auth/login?redirect=1&next=${encodeURIComponent(nextPath)}`}
          style={{ marginTop: 14, display: "grid", gap: 10 }}
        >
          <div>
            <div style={labelStyle}>아이디(emp_id)</div>
            <input
              name="loginId"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="예: 1001"
              style={inputStyle}
              autoComplete="username"
            />
          </div>

          <div>
            <div style={labelStyle}>비밀번호</div>
            <input
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              style={inputStyle}
              type="password"
              autoComplete="current-password"
            />
          </div>

          <button type="submit" style={btnStyle}>
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.8,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  cursor: "pointer",
};
