// app/exam/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExamClient from "./ExamClient";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}

export default async function Page() {
  const ck = await cookies(); // ✅ 중요 (Promise 대응)

  const role = s(ck.get("role")?.value);
  const empId = s(ck.get("empId")?.value);

  if (!empId) redirect("/login?next=/exam");
  if (role === "admin") redirect("/admin");

  return <ExamClient />;
}
