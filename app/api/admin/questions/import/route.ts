import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normChoices(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).slice(0, 4);
}

// ✅ NaN/빈값/null 들어와도 절대 null로 안 흘러가게 숫자 정리
function toInt(v: any, fallback: number) {
  // "", null, undefined, " " -> NaN 처리
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  if (s === "") return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * DB 스키마:
 * - choices NOT NULL
 * - answer_index NOT NULL (0~3)
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (!raw) return NextResponse.json({ error: "요청 바디가 비었습니다." }, { status: 400 });

    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "요청 JSON 파싱 실패" }, { status: 400 });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return NextResponse.json({ error: "items가 비었습니다." }, { status: 400 });

    const payload = items.map((it: any) => {
      const choices = normChoices(it.choices);

      // ✅ UI가 answer(1~4)로 보내든 answer_index(0~3)로 보내든 둘 다 수용
      const aiFromIndex = it.answer_index;
      const aFromAnswer = it.answer;

      let answer_index: number;
      // answer_index 우선
      if (aiFromIndex !== undefined && aiFromIndex !== null && String(aiFromIndex).trim() !== "") {
        answer_index = toInt(aiFromIndex, 0);
      } else {
        // answer(1~4) -> answer_index(0~3)
        const a = toInt(aFromAnswer, 1);
        answer_index = a - 1;
      }

      return {
        content: String(it.content ?? "").trim(),
        choices,
        answer_index,
        points: toInt(it.points, 1),
        is_active: Boolean(it.is_active ?? true),
      };
    });

    // ✅ 여기서 “DB 넣기 전에” 확실히 검증해서, DB 500 안 나게 함
    for (let i = 0; i < payload.length; i++) {
      const p = payload[i];

      if (!p.content) {
        return NextResponse.json({ error: `CSV ${i + 1}번째 행: 문제내용(content)이 비었습니다.` }, { status: 400 });
      }
      if (!Array.isArray(p.choices) || p.choices.length < 4 || p.choices.some((x) => !x)) {
        return NextResponse.json({ error: `CSV ${i + 1}번째 행: 보기(choices) 4개가 모두 필요합니다.` }, { status: 400 });
      }
      if (![0, 1, 2, 3].includes(p.answer_index)) {
        return NextResponse.json({
          error: `CSV ${i + 1}번째 행: 정답이 잘못됐습니다. (answer_index=${p.answer_index}) 정답은 1~4로 입력하세요.`,
          debug: { received_answer: items[i]?.answer, received_answer_index: items[i]?.answer_index },
        }, { status: 400 });
      }
      if (!Number.isFinite(p.points) || p.points < 0) {
        return NextResponse.json({ error: `CSV ${i + 1}번째 행: 배점(points)은 0 이상 숫자여야 합니다.` }, { status: 400 });
      }
    }

    // ✅ 최종 insert (answer_index가 절대 null/NaN로 안 들어감)
    const { error } = await supabaseAdmin.from("questions").insert(payload);

    if (error) {
      // DB 에러가 나면 첫 행 샘플 같이 보여줌(원인 추적용)
      return NextResponse.json({
        error: `DB insert 실패: ${error.message}`,
        sample: payload[0],
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inserted: payload.length });
  } catch (e: any) {
    return NextResponse.json({ error: `import 서버 오류: ${e?.message || "unknown"}` }, { status: 500 });
  }
}
