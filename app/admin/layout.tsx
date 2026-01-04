// app/admin/layout.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const pill = (active: boolean): React.CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid #ddd",
    background: active ? "#000" : "#fff",
    color: active ? "#fff" : "#111",
    cursor: "pointer",
    fontSize: 13,
  });

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ borderBottom: "1px solid #eee", background: "#fff" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>관리자</div>

            <button style={pill(isActive("/admin/accounts"))} onClick={() => router.push("/admin/accounts")}>
              계정관리
            </button>
            <button style={pill(isActive("/admin/questions"))} onClick={() => router.push("/admin/questions")}>
              문제등록
            </button>
            <button style={pill(isActive("/admin/results"))} onClick={() => router.push("/admin/results")}>
              응시현황
            </button>
          </div>

          <button
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #000",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => router.push("/exam")}
          >
            응시페이지로
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>{children}</div>
    </div>
  );
}
