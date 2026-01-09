// app/admin/page.tsx
import Link from "next/link";

export default function AdminHomePage() {
  const menus = [
    { href: "/admin/questions", label: "시험문항 관리" },
    { href: "/admin/results", label: "응시현황" },
    { href: "/admin/accounts", label: "응시자 계정 관리" },
    // ✅ 오답 누적 메뉴 제거
    // { href: "/admin/wrong", label: "오답 누적" },
  ];

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 14 }}>관리자 홈</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {menus.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            style={{
              padding: "10px 14px",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              textDecoration: "none",
              fontWeight: 700,
              color: "#111827",
              background: "white",
            }}
          >
            {m.label}
          </Link>
        ))}
      </div>

      <p style={{ marginTop: 12, color: "#6b7280" }}>위 메뉴로 이동해서 관리하세요.</p>
    </div>
  );
}
