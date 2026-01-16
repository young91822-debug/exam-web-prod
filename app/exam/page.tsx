// app/exam/page.tsx  ✅ SERVER COMPONENT

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExamClient from "./ExamClient";

export const dynamic = "force-dynamic";

export default function ExamPage() {
  const c = cookies();

  const empId = c.get("empId")?.value || "";
  const role = c.get("role")?.value || "";

  // ✅ 로그인 안 됐으면
  if (!empId) {
    redirect("/login?next=/exam");
  }

  // 🔥 관리자면 HTML 자체를 못 보게 바로 차단
  if (role === "admin") {
    redirect("/admin");
  }

  // ✅ 여기까지 온 경우만 응시자
  return <ExamClient />;
}
