// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });

  // 쿠키 전부 삭제(프로젝트에서 쓰는 후보들)
  const keys = ["empId", "emp_id", "userId", "employeeId", "emp", "admin"];
  for (const k of keys) {
    res.cookies.set(k, "", { path: "/", maxAge: 0 });
  }

  return res;
}
