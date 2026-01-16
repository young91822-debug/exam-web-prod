// app/exam/page.tsx  ✅ SERVER COMPONENT (Next.js async cookies 대응)

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExamClient from "./ExamClient";

export const dynamic = "force-dynamic";

export default async function ExamPage() {
  const c = await cookies(); // ✅ Next.js 버전에 따라 Promise일 수 있음

  const empId = c.get("empId")?.value || "";
  const role = c.get("role")?.value || "";

  if (!empId) {
    redirect("/login?next=/exam");
  }

  // ✅ 관리자는 시험 페이지 HTML 자체 차단
  if (role === "admin") {
    redirect("/admin");
  }

  return <ExamClient />;
}
