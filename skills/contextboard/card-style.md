# Card style

How cards get written on this workspace. Read this before creating or editing a
card; `SKILL.md` covers the API, this covers the writing. Derived by reading
every card on `超級專案管理` (19) and `物理史` (12).

This file is not embedded in the skill the agent server serves. It is a
workspace convention, not product documentation.

Rules are graded, and the grade matters more than the wording:

- **[observed]** — holds across both boards. Follow it.
- **[preference]** — the usual choice, with real exceptions. Follow it unless
  the card gives you a reason not to.
- **[optional]** — seen once or twice. Available, not expected.

Counts below are from the boards as of 2026-08-12. If a rule and a card
disagree, the card wins.

## Titles

**[observed] The first line is the title, plain text, no `#`, and it carries a
claim or an event.** 14 of the 18 substantive project cards use full-width `⇒`
to join cause and consequence: `規劃謬誤⇒低估時間與成本`,
`搶第一⇒獨特性偏誤`, `奧運⇒輪流舉辦，無經驗傳承，又追求更大更好，每次都爆預算`.
When the card holds both a problem and its fix, both go in the title:
`意外造成專案失敗，解決方法⇒慢思快行，縝密規劃速戰速決`. History cards use
`年份 + 人 + 事` instead: `1859 Kirchhoff 提出黑體輻射`,
`1925 Born–Jordan 2-man paper`.

**[preference] Bare labels are reserved for cards that gather other cards.**
`經驗的重要性`, `改善專案領導的捷思法`, `Amazon 如何利用目標回推方案` and
`1879～1884 Stefan-Boltzmann formula` are descriptive, and they earn it by being
hubs or by having the date supply the direction. A card making one argument
should not have a label title.

## Card boundaries

**[observed] One card = one thing that should be recalled as a unit.** That
unit is often a single argument, but it is just as often a synthesis:
`改善專案領導的捷思法` holds eleven heuristics, `齊心協力⇒有使命感的團隊` holds
several strategies, the Wien card covers two laws, the Planck card covers a
development across four years. Cards run 150–2200 characters and length follows
the material.

Do not split to even out length, do not merge because two cards are short, and
do not split by source document — see the AI tells at the end.

**[observed] The body preserves enough reasoning to reconstruct the
conclusion.** Physics cards carry every substitution and intermediate form.
Prose cards carry the chain, not the verdict: not 「慢思快行」 but 意外累加 →
趕工的代價 → 所以先規劃.

## How a prose card moves

**[observed] The engine is contrast.** 常見直覺 → 但實際上 → 背後機制 →
因此該怎麼做:

> 傳統觀點認為，訂定嚴格的時間表，甚至縮短工期可以解決問題。但實際上趕工造成
> 的預算增加，以及品質下滑都是顯而易見的負面後果。…因此，與其訂定不合理的期
> 限，不如先花時間描繪專案的細節

The same reversal drives 倖存者偏差 (「世人總有種錯覺…真的是這樣嗎？」),
搶第一 (「先進者優勢被過度放大，實際上…」), 預測失準, 承諾謬誤, 奧運.
Caveats and boundary conditions belong here, in the middle, where they change
the argument — not bolted onto the end.

**[observed] The last line is a punch line, not a caveat.** It restates the
claim at its sharpest — 「模組化增加成功率。」「一開始就走錯路了」「面對大型專案
時，最寶貴的是有實務經驗的領導者。」 — or, on physics cards, says what the result
means or what it skipped: 「創造出第二類永動機」「跳過了…的過程直接得出結果」
「就已經躲在普朗克的數學湊合裡了」. Exactly one card of 31 ends on a limit. Do
not manufacture a closing caveat.

## How a derivation card moves

**[observed] Never two display equations in a row.** A Chinese sentence goes
between them saying what you just did: 轉換一下順序 / 左右移項 / 一樣作二次微分 /
記得把光速帶回去 / 注意到有一個負號 / 帶入 $dU=Vdu+udV$ / 現在我們知道內能
$U=uV$ 與壓力 $P=\frac1 3 u$，可以建立熱力學模型.

Imperative, first-person-plural, addressed to your future self. `記得`,
`注意到`, `現在我們知道`, `帶入` are the workhorses. A derivation without this
narration reads like someone else wrote it.

## Voice

**[observed] Code-switching has rules.** Technical nouns stay in the language
you would meet them in — Entropy, Isotropic, mode, universal function,
Oscillator, eigenvalue, wave function, Hamiltonian, product market fit, agile,
PR/QA. Chinese carries the connective reasoning. Never translate a term you
would have to un-translate to read a paper. Grammar switches mid-sentence when
English is shorter, and that is correct, not sloppy: 「記得$u=u(\nu, T)$ and $T$
is also dependent on $u$」, 「where 總能量密度across 不同頻率」,
「But 由於我們的系統絕熱且孤立」.

**[observed] Personality runs through the explanation, not beside it.** Blunt
colloquialism in the main line is the norm: 「這只是湊答案」「他也沒有辦法」
「頭洗下去再說」「錢坑」「一開始就走錯路了」「爆預算家常便飯」. Parentheses take
the jokes, hedges and shortcuts: 「（反例：看看project no.9改編的動畫）」
「（一開始考慮好，就不用這麼辛苦了）」「（雖然那時候Jeans還沒出場）」
「（麻煩到我覺得已經不是重點了，但結果重要）」. `btw` opens a tangent worth
keeping.

**[preference] `---` then `我的想法：` is for a substantial original reading**
of the material, at the end of the card — seen on 倖存者偏差 and the Amazon
card. Small judgements do not need fencing; they belong inline.

**[observed] Ask the question before answering it.** 「真的是這樣嗎？」
「但這個函數是什麼？」「但為什麼要蓋？理由是什麼」「但Planck真的有提出能量是離散
的嗎？」

**[observed] Keep the people in.** Ideas stay attached to humans who were
reluctant, political, wrong or lucky: 「Planck作為物理學家，這樣的結果是不能接受
的！」「最終使用競爭對手Boltzmann的理論」「設計師中途就被辭退，他的生涯就此結
束」「並非選擇國外經驗豐富的廠商，而是美國本土缺乏經驗的供應商」.

## Evidence

**[observed] Abstractions land on something picturable**, by preference
something local: 安坑輕軌、加州高鐵、東豐快速道路、AMD→台積電→日月光、Tesla、
麥當勞、雪梨歌劇院.

**[preference] Keep the source's figures exactly** rather than softening them
to 「很多」: 預計日運量9萬人／實際不到5000、超支平均62%、IT專案447%、同時達標
只有0.5%、皮克斯改8次、$b\approx2898\mu m\cdot K$. Many good cards contain no
numbers at all. **Never invent a figure to satisfy this rule** — a card with no
numbers is fine, a card with a plausible-looking fabricated number is not.

## Formatting

- **[observed]** No blank lines between paragraphs; a single newline. Blank
  lines only where Markdown demands them.
- **[observed]** `##` only when a card spans more than one moment, and the
  heading names that moment: `## 1879 Josef Stefan 實驗歸納`,
  `## 1884 Ludwig Boltzmann 電磁學推導`, `## 波函數的意義`. A single-moment card
  has no headings — the whole `超級專案管理` board uses none.
- **[observed]** Bullets for genuine enumerations, each as `短標籤 ⇒ 說明`.
  Numbered lists take 2-space-indented continuation lines for sub-detail.
- **[observed]** Full-width punctuation: `⇒` `→` `～` `＆` `、`.
- **[observed]** Inline math `$...$`, display `$$...$$`, `\begin{aligned}` for
  multi-step algebra. Write LaTeX through a UTF-8 client that does not eat
  escapes — `\nu` and `\nabla` have already been silently turned into newlines
  on two physics cards.

## Board layout

**[observed] X is the spine, Y is the branch.** Left to right is the narrative:
1859→1879→1893→1900→1925–26 on `物理史`; 問題→診斷→方法→執行 on
`超級專案管理`, less strictly. Rows stacked in Y are parallel threads or a new
era.

**[observed] Placement is hand-made and load-bearing.** Columns are default 576
wide. Do not run `arrange_cards` on an established board without asking.

**[preference] Cards stand alone and rely on position for context.** Only one
card of 19 uses `contextboard:` references, and the human physics cards use
none. Add a reference when a card's role would otherwise be ambiguous — the way
`經驗的重要性` cites 搶第一 and 奧運 as its causes and instances — and put it in
the sentence making the claim. Do not make every card announce its position.

**[preference] Arrows are few and their meaning varies.** Eight relations among
18 substantive cards, covering problem→method, fallacy→fallacy→fallacy,
principle→example, example→concept, implementation→implementation. Use one when
seeing the link on the canvas adds something. Do not encode the whole graph.

**[optional] A reconciliation block.** When two accounts are meaningfully
resolved by a third idea, record it — the Rayleigh-Jeans card ends with `---`
then 極限關係一覽, showing Planck reducing to both Wien and Rayleigh-Jeans in
opposite limits. Seen once, inside an existing card rather than as a new card.

## What "AI wrote this" looks like

Five cards on `物理史` (the 1925–26 quantum mechanics row, x≥5193) were
machine-written and read as the inverse of everything above. They are correct
and flat. The tells:

- Uniform `##` sections on every card, same template, same tidy closing
  paragraph restating what was just said.
- No `記得`, no `注意到`, no `btw`, no parenthetical asides, no colloquialism.
- Nobody in the story has a motive; no local example; no figures.
- `1925 Heisenberg 1-man paper` and `1925 Heisenberg 矩陣力學` overlap heavily —
  split by source document instead of by idea.

If a draft has none of the voice markers and closes by summarising itself, it
is wrong even when every fact in it is right. This is the most reliable test in
this document: compare against those five cards, not just against the rules.
