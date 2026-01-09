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

  // ✅ 관리자 접근 제한 (원하면 조건 바꿔도 됨)
  // - empId 없으면 로그인으로
  if (!empId) redirect("/login");

  // - role 체크를 쓸 거면 아래처럼 (role을 안쓰면 이 블록 삭제)
  // if (role !== "admin") redirect("/login");

  return (
    <div style={{ minHeight: "100vh" }}>
      {children}
    </div>
  );
}
