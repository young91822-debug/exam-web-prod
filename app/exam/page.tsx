// app/exam/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExamClient from "./ExamClient";

export const dynamic = "force-dynamic";

export default async function ExamPage() {
  // ✅ Next.js 14+ : 반드시 await
  const c = await cookies();

  const empId = c.get("empId")?.value || "";
  const role = c.get("role")?.value || "";

  // ✅ 로그인 안 했으면
  if (!empId) {
    redirect("/login?next=/exam");
  }

  // ✅ 관리자는 시험 절대 금지
  if (role === "admin") {
    redirect("/admin");
  }

  // ✅ 응시자만 여기 도달
  return <ExamClient />;
}
