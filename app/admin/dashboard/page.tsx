// app/admin/dashboard/page.tsx
"use client";

import Link from "next/link";

export default function AdminDashboardPage() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>관리자 대시보드</h1>

      <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <Link
          href="/admin/accounts"
          style={{
            display: "block",
            padding: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            textDecoration: "none",
            color: "#111827",
            background: "white",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>계정관리</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>계정 생성 / 삭제</div>
        </Link>

        <Link
          href="/admin/questions"
          style={{
            display: "block",
            padding: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            textDecoration: "none",
            color: "#111827",
            background: "white",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>문제등록</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>CSV 업로드 / 직접 등록</div>
        </Link>

        <Link
          href="/admin/results"
          style={{
            display: "block",
            padding: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            textDecoration: "none",
            color: "#111827",
            background: "white",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>응시현황</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>계정별 점수/오답 확인 + 다운로드</div>
        </Link>
      </div>
    </div>
  );
}
