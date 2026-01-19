// app/admin/layout.tsx
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // ✅ Next 16+에서는 cookies()가 Promise로 올 수 있어서 await 필요
  const c = await cookies();

  const empId = c.get("empId")?.value || c.get("emp_id")?.value || "";
  const role = c.get("role")?.value || "";

  // ✅ 관리자 접근 제한
  if (!empId) redirect("/login");
  // if (role !== "admin") redirect("/login"); // 필요하면 사용

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background:
          "linear-gradient(135deg, #0f172a 0%, #020617 55%, #020617 100%)",
        color: "#e5e7eb",
      }}
    >
      {/* ✅ 관리자 화면 공통 패딩/폭 통일 (원치 않으면 padding만 지워) */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {children}
      </div>
    </div>
  );
}
