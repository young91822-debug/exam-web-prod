// app/result/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function s(v: any) {
  return String(v ?? "").trim();
}

export default function ResultPage() {
  const ck = cookies();
  const role = s(ck.get("role")?.value);
  const empId = s(ck.get("empId")?.value);

  if (!empId || role !== "admin") redirect("/login");
  redirect("/admin/results");
}
