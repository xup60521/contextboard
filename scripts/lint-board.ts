/**
 * Lint a whiteboard against skills/contextboard/card-style.md.
 * Only the mechanically checkable rules — voice and joint quality still need eyes.
 *
 * Aimed at agent-generated boards. Hand-made boards will false-positive: they
 * carry joints as plain concept names rather than contextboard: links, and their
 * arrows often land on tldraw text elements the API cannot see.
 *
 * It also lints a board as one layer. A research board built with
 * skills/contextboard/research-flow.md has a note layer under the argument
 * layer whose cards carry no joints and whose arrows mean containment, so
 * rules 1, 2, 4, 5 and 6 all fire on it. Read those hits against the argument
 * layer only until this understands the Source overview / Detail note prefixes.
 *
 *   bun scripts/lint-board.ts <whiteboardId>
 */
import { homedir } from "node:os";

const { port } = await Bun.file(`${homedir()}/.contextboard/agent-server.json`).json();

const call = async <T>(tool: string, body: Record<string, unknown> = {}): Promise<T> => {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; error?: { message: string } };
  if (!json.ok) throw new Error(`${tool}: ${json.error?.message}`);
  return json.result!;
};

type Item = { cardId: string; card: { title: string }; x: number; y: number };
type Relation = { sourceCardId: string; targetCardId: string };

const whiteboardId = process.argv[2];
if (!whiteboardId) throw new Error("usage: bun scripts/lint-board.ts <whiteboardId>");

const [items, relations] = await Promise.all([
  call<Item[]>("list_board_items", { whiteboardId }),
  call<Relation[]>("list_relations", { whiteboardId }),
]);

// Sequential: the agent server rejects a burst of concurrent reads.
const cards = new Map<string, string>();
for (const { cardId } of items) {
  const { text } = await call<{ text: string }>("get_card", { cardId });
  cards.set(cardId, text);
}

// Built fresh per call: a shared /g regex carries lastIndex between calls.
const ref = () => /\[[^\]]*\]\(contextboard:card\/([0-9a-f-]+)\)/g;
const lines = (t: string) => t.split("\n").filter((l) => l.trim());
const refsIn = (t: string) => [...t.matchAll(ref())].map((m) => m[1]);
const sentences = (t: string) => t.split(/[。！？]/).filter((s) => s.trim());
const normalise = (s: string) => s.replace(ref(), "[REF]").trim();

const fail: string[] = [];
const warn = (cond: boolean, msg: string) => cond && fail.push(msg);
const pct = (n: number) => `${n}/${cards.size}`;

// 1. joint placement — not the title, not the closing sentence.
// (Line position is useless here: most cards are a single paragraph.)
const misplaced = [...cards.values()].filter((t) => {
  const body = lines(t).slice(1).join("\n");
  return ref().test(sentences(body).at(-1) ?? "");
}).length;
warn(misplaced > 0, `${pct(misplaced)} 張卡的 reference 在收尾句（應在中段的論證句裡）`);

// 2. star detection — distinct targets, and no target above three joints
const inDegree = new Map<string, number>();
for (const text of cards.values())
  for (const id of refsIn(text)) inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
const hot = [...inDegree].filter(([, n]) => n > 3);
const jointed = [...cards.values()].filter((t) => refsIn(t).length > 0).length;
warn(jointed < cards.size / 2, `只有 ${pct(jointed)} 張卡寫了 joint`);
warn(jointed >= cards.size / 2 && inDegree.size < cards.size / 3, `joint 目標只有 ${inDegree.size} 個（${cards.size} 張卡）：星形`);
for (const [id, n] of hot)
  fail.push(`「${items.find((i) => i.cardId === id)?.card.title.slice(0, 28)}」被 ${n} 張卡指向（上限 3）`);

// 2b. chain detection — the other way to default a joint target
const longestChain = (() => {
  const seen = new Map<string, number>();
  const walk = (id: string, path: Set<string>): number => {
    if (path.has(id)) return 0;
    const cached = seen.get(id);
    if (cached !== undefined) return cached;
    const next = [...new Set(refsIn(cards.get(id) ?? ""))];
    const d = Math.max(0, ...next.map((n) => 1 + walk(n, new Set(path).add(id))));
    seen.set(id, d);
    return d;
  };
  return Math.max(...[...cards.keys()].map((id) => walk(id, new Set())));
})();
warn(longestChain > 6, `最長 joint 鏈 ${longestChain} 張（上限 6）：鏈狀，每張都指前一張`);

// 2c. shape — a chain shows up as a board taller than it is wide
const span = (k: "x" | "y") => {
  const v = items.map((i) => i[k]);
  return Math.max(...v) - Math.min(...v);
};
warn(span("y") > span("x"), `板子 ${Math.round(span("y") / span("x"))}× 高於寬：捲軸，不是板`);

// 3. boilerplate — the same sentence written twice is a template
const seen = new Map<string, number>();
for (const text of cards.values())
  for (const s of sentences(text).map(normalise))
    if (s.length > 12) seen.set(s, (seen.get(s) ?? 0) + 1);
for (const [s, n] of [...seen].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 3))
  fail.push(`樣板句重複 ${n} 次：「${s.slice(0, 40)}」`);

// 4. figures — a board that never quotes a number did not read a source.
// (Latin/《》 are not proxies for an anchor: a glossary of theory terms has both.)
const figured = [...cards.values()].filter((t) => /\d+\s*(%|％|萬|億|倍|人|年)|\b(18|19|20)\d{2}\b/.test(t)).length;
warn(figured < cards.size * 0.1, `只有 ${pct(figured)} 張卡帶具體數字或年份`);

// 5. uniform rhythm — every card the same shape is a form letter
const counts = [...cards.values()].map((t) => sentences(t).length);
const spread = Math.max(...counts) - Math.min(...counts);
warn(spread <= 2, `每張卡都是 ${Math.min(...counts)}~${Math.max(...counts)} 句：節奏一致 = 樣板`);

// 6. arrows must echo a joint that already exists in the prose
const unbacked = relations.filter(
  ({ sourceCardId, targetCardId }) =>
    !refsIn(cards.get(sourceCardId) ?? "").includes(targetCardId) &&
    !refsIn(cards.get(targetCardId) ?? "").includes(sourceCardId),
).length;
warn(unbacked > 0, `${unbacked}/${relations.length} 條 arrow 在正文中沒有對應的 joint`);

console.log(`${cards.size} 張卡・${relations.length} 條 arrow・${inDegree.size} 個 joint 目標\n`);
if (fail.length === 0) console.log("✅ 機械檢查全過。剩下的要用眼睛看：joint 是否真的在論證裡做事。");
else for (const f of fail) console.log(`❌ ${f}`);
