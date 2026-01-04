"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function hasCookie(key: string) {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((c) => c.trim().startsWith(key + "="));
}

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, password }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "로그인 실패");

      // 쿠키 반영 대기
      await new Promise((r) => setTimeout(r, 100));

      const okUserId = hasCookie("user_id");
      const okUserUuid = hasCookie("user_uuid");

      if (!okUserId) {
        throw new Error(
          "로그인 성공했지만 user_id 쿠키가 저장되지 않았습니다.\n" +
          "→ Network 탭에서 login 응답의 Set-Cookie를 확인하세요."
        );
      }

      if (json?.role !== "admin" && !okUserUuid) {
        throw new Error(
          "로그인 성공했지만 user_uuid 쿠키가 없습니다.\n" +
          "→ accounts.id(UUID) 컬럼을 확인하세요."
        );
      }

      if (json?.role === "admin") router.push("/admin");
      else router.push("/exam");
    } catch (e: any) {
      setMsg(e?.message || "오류 발생");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 14 }}>
        로그인
      </h1>

      {msg && (
        <div
          style={{
            color: "crimson",
            marginBottom: 10,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="아이디"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={input}
        />
        <input
          placeholder="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
        />

        <button onClick={onLogin} disabled={loading} style={btn}>
          {loading ? "로그인 중..." : "로그인"}
        </button>

        <button
          type="button"
          style={btn2}
          onClick={() =>
            alert(
              `document.cookie:\n\n${document.cookie || "(쿠키 없음)"}`
            )
          }
        >
          (디버그) document.cookie 보기
        </button>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  outline: "none",
  fontSize: 14,
};

const btn: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btn2: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};
