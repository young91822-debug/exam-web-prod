// app/exam/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ExamClient from "./ExamClient";

export const dynamic = "force-dynamic";

export default async function ExamPage() {
  const c = await cookies();

  const empId = c.get("empId")?.value || "";
  const role = c.get("role")?.value || "";

  if (!empId) redirect("/login?next=/exam");
  if (role === "admin") redirect("/admin");

  return <ExamClient />;
}
