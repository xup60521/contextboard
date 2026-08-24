# Card style

How to write cards in this workspace. `SKILL.md` covers the API; this covers
the writing. When a rule and an existing card disagree, the card wins **on
voice**. On structure — joints, scope, layout — the rules win, because the
boards this file exists to fix are existing cards too.

The single test: **a card should read like a smart person's working notes to
their future self — opinionated, reasoned, alive — not like documentation.**
Every rule below serves that.

## What a card is

One card = one thing worth recalling as a unit. That unit may be a single
argument, or a synthesis of many parts (eleven heuristics, a derivation
spanning four years). Length follows the material — anywhere from a paragraph
to a long derivation.

Three kinds of card:

- **Argument card** — the default. It is finished when it fills five slots:
  主張（title，因⇒果）→ 機制（為什麼會這樣）→ 具名案例＋真實數字 →
  後果／該怎麼做 →（選配）我的想法.
  Length is whatever the slots need: `規劃謬誤⇒低估時間與成本` fills all five
  in 144 characters, `由小東西組成大東西⇒模組化` needs 604. Neither was padded
  or trimmed toward a length.
  **The slots are coverage, not an outline.** Writing one sentence per slot in
  that order gives every card on the board the same shape, which is its own
  failure. `倖存者偏差` opens with a question and spends three sentences on
  雪梨歌劇院; `規劃謬誤` folds 機制 and 後果 into a single sentence. Check the
  slots are covered. Never let them dictate the sentence order.
- **Hub card** — gathers other cards, and **its body is the substance itself,
  not a description of the substance**. `改善專案領導的捷思法` holds eleven
  heuristics, every one of them a real claim; do not split it. A card whose body
  only announces what its section contains（「這一組把 X 拆成 Y、Z 三種形態」）
  is a table of contents, not a hub card, and it does not belong on the board.
  If a section needs a name but has no substance of its own, it does not need a
  card — use a nested whiteboard, or let position say it.
- **Case card** — one named case, short by design, existing so an argument card
  can cite it as an 實例（`奧運⇒輪流舉辦…`、`Amazon 如何利用目標回推方案`).
  Short is correct here. This is not the atomic failure.

Other rules:

- An idea that cannot fill five slots is not a card yet. Merge it into the card
  it belongs to, or demote it to a case card that an argument card cites.
- Do not split cards to even out length.
- Do not merge cards just because they are short.
- Do not split by source document. Split by *idea*. Two cards that heavily
  overlap because they came from two sources should be one card.
- The body must preserve enough reasoning to reconstruct the conclusion.
  Write the chain, not the verdict: not 「慢思快行」 but
  意外累加 → 趕工的代價 → 所以先規劃. Derivations keep every substitution
  and intermediate form.

## Titles

The first line is the title: plain text, no `#`, and it carries a **claim or
event**, not a topic label.

- Argument cards: join cause and consequence with full-width `⇒`, e.g.
  `規劃謬誤⇒低估時間與成本`. If the card holds both problem and fix, both go
  in the title: `意外造成專案失敗，解決方法⇒慢思快行，縝密規劃速戰速決`.
- History cards: `年份 + 人 + 事`, e.g. `1859 Kirchhoff 提出黑體輻射`. When a
  card sits on a 時序 joint, the title must carry the time marker — that is
  what lets a reader recover the order from titles alone.
- Bare labels (`經驗的重要性`) are allowed only for hub cards that gather
  other cards, or where a date supplies direction. A card making one argument
  must not have a label title.

## How a prose card moves

The engine is **contrast**: 常見直覺 → 但實際上 → 背後機制 → 因此該怎麼做.

> 傳統觀點認為，訂定嚴格的時間表，甚至縮短工期可以解決問題。但實際上趕工
> 造成的預算增加，以及品質下滑都是顯而易見的負面後果。…因此，與其訂定不合
> 理的期限，不如先花時間描繪專案的細節

- Ask the question before answering it: 「真的是這樣嗎？」「但這個函數是什麼？」
- Caveats and boundary conditions go **in the middle**, where they change the
  argument. So do joints — see How cards connect.
- The last line is a punch line, not a caveat and not a summary. It restates
  the claim at its sharpest: 「模組化增加成功率。」「一開始就走錯路了」. On
  technical cards it says what the result means or skipped:
  「跳過了…的過程直接得出結果」. Never manufacture a closing caveat, and never
  close by restating what the card just said.

## How a derivation card moves

Never two display equations in a row. Between them goes a Chinese sentence
saying what you just did — imperative, first-person-plural, addressed to your
future self: 轉換一下順序 / 左右移項 / 記得把光速帶回去 / 注意到有一個負號 /
現在我們知道內能 $U=uV$ 與壓力 $P=\frac13 u$，可以建立熱力學模型.

`記得`, `注意到`, `現在我們知道`, `帶入` are the workhorses. A derivation
without this narration reads like someone else wrote it — which means it's
wrong for this workspace.

## How cards connect

This section governs argument cards — the cards a finished board is made of.
A research board carries a second, weaker arrow language underneath it for
source containment; see `research-flow.md`.

A board is not a pile of good cards. **The relation between two cards lives in
the prose, not in the arrow.** A canvas relation has a direction but no label:
an arrow can say which way, never why. A line drawn between two sealed cards
still communicates nothing — the board looks structured and reads
disconnected.

Every card except the scope card must name at least one other card **inside the
sentence that advances its own argument**, as one of five joints:

| Joint | What the card inherits | From the boards |
| --- | --- | --- |
| **承接** | the upstream card's conclusion, used as this card's premise | 慢思⇒問為什麼：「人很容易落入**承諾謬誤**，以為現行的方案就是唯一的方案」 |
| **張力** | an apparent contradiction with the upstream card, then resolves it | 迭代的矽谷經驗：「看起來這個過程**違反慢思快行**，但實際上不斷迭代也是規畫的一環」 |
| **實例** | nothing — this card *is* the case that pays for the upstream claim | 經驗的重要性：「具體例子：[奧運⇒輪流舉辦…](contextboard:card/…)」 |
| **組件** | the children it is assembled from | 齊心協力：「1. **皮克斯規劃**、利用**參考群組預測**」 |
| **時序** | the unsolved problem or standing condition the previous card left | 「Kirchhoff 留下的分布沒人算得出來，Planck 接手時…」 |

The rules that make this real:

- **Write the joint as an inline reference**: `[label](contextboard:card/<id>)`.
  The backlink is the point, and it is what makes the joint checkable.
- **The joint goes in the middle of the card.** Never in the title, never in
  the closing sentence, never as a sentence whose only content is the
  reference. A reference appended after the argument is finished is a retrofit,
  and it reads as one. (Position by *sentence*, not by line — most cards are a
  single paragraph.)
- 「這與 X 相關」「本卡呼應 X 的討論」 **is not a joint.** It is a name-drop.
  If the neighbour's name can be deleted without the sentence losing its
  argument, the joint is fake.
- **時序 joints are not satisfied by a date.** The year in the title supplies
  ordering, not relation. The body must still say what the previous card left
  unsolved and how this one takes it up.
- **Every joint is drawn as an arrow, and nothing else is.** The arrow is the
  joint's mechanical projection — one per joint, running the way the joint runs,
  from the card being leaned on to the card leaning on it. No joint, no arrow;
  no arrow, no joint. There is no target arrow count and no separate judgement
  about which joints deserve a line: both follow from the text, and the density
  is already capped by the joints themselves.

Four more rules, all of which exist because a board once satisfied everything
above and still read as fifty disconnected definitions:

- **A joint must point at a claim, not at a section.** A legal target is a card
  whose title carries a claim（`⇒`）or an event（年份）. Joining to a section
  label — `三種文化資本`、`理論起點與問題意識` — is not a joint. It restates
  where the card sits, which the layout already shows, and it costs nothing to
  write, which is why a model will write it fifty times.
- **No card may be the target of more than three joints.** If everything points
  at the same two or three cards, the joints are carrying topology, not
  argument. A star is not a structure.
- **The target must be chosen, not defaulted.** Two defaults keep appearing,
  and both are wrong for the same reason — the target is decided by position
  instead of by argument:
  - **星形** — every card joins to the hub of its section.
  - **鏈** — every card joins to the one written just before it（「承接 X」
    「接在 X 之後」「這張卡接手 X」, fifty times in a row）.

  Test: **if you can predict a card's joint target from where it sits, it is
  not a joint.** The target is whichever earlier card this one actually uses,
  and that is usually not the neighbour.
- **A joint chain may not run more than six cards deep.** A board is a wide,
  shallow tree, not an essay cut into pieces. With a cap of three joints per
  target, even 70 cards fit in four levels — so a chain of twenty means every
  card took the card before it and nobody looked sideways.
- **The deletion test.** Delete the joint sentence and re-read the card. If it
  is just as good without it, the joint was decoration. The neighbour has to be
  doing work in the argument, not being greeted.
- **A board may not run on one joint type, and may not reuse a joint sentence.**
  承接 is the cheap one and it will eat the other four if allowed. A board with
  zero 實例 has not gone looking for cases. If the same phrasing appears on two
  cards（「沿著 X 的理路」「承接 X 的問題」）, both are boilerplate — rewrite
  them from the argument, not from a template.

**The procedure matters more than any of these rules.** Write the card's
argument first, without thinking about links. Then read it back and ask: *which
earlier claims did I lean on to make this work?* Those are the joints — link
them where they are already being used. Doing it the other way round (pick a
neighbouring card, then compose a sentence that mentions it) is what produces
stars and chains, because the neighbour was chosen before the argument existed.

The joint is also the test for what belongs on the board at all. See Scope.

## Voice

- **Code-switching is deliberate.** Technical nouns stay in the language you'd
  meet them in (entropy, eigenvalue, Hamiltonian, product market fit, PR/QA);
  Chinese carries the connective reasoning. Never translate a term you would
  have to un-translate to read a paper. Grammar may switch mid-sentence when
  English is shorter: 「But 由於我們的系統絕熱且孤立」. That is correct, not
  sloppy.
- **Personality runs through the main line**, not beside it. Blunt
  colloquialism is the norm: 「這只是湊答案」「頭洗下去再說」「錢坑」
  「爆預算家常便飯」. Parentheses take jokes, hedges and shortcuts:
  「（一開始考慮好，就不用這麼辛苦了）」. `btw` opens a tangent worth keeping.
- **Keep the people in.** Ideas stay attached to humans who were reluctant,
  political, wrong or lucky: 「Planck作為物理學家，這樣的結果是不能接受的！」
  「設計師中途就被辭退，他的生涯就此結束」.
- `---` then `我的想法：` at the end of a card fences a substantial original
  reading. Small judgements don't need fencing; they belong inline.

## Evidence

- **Every card carries at least one 具名 anchor**: a person, a year, a titled
  work, a place, a named study, or a figure. 「進到修車廠或地方社群卻未必帶來
  信任」 is a hypothetical, not an anchor. 「1979《區隔》」「安坑輕軌預計日運量
  9萬，實際不到5000」「加州高鐵」「DiMaggio 1982」 are anchors. **A card that
  could have been written without reading anything has no anchor**, and a board
  of such cards is a glossary.
- Ground abstractions in something picturable, preferably local to Taiwan:
  安坑輕軌、加州高鐵、台積電、雪梨歌劇院.
- Keep the source's figures exactly (超支平均62%、同時達標只有0.5%) rather
  than softening to 「很多」. Not every card can carry a number — but a card
  with neither a number nor a named case is a definition, not a note.
- **Never invent a figure**, and never invent the anchor either. A
  plausible-looking fabricated number is worse than no number. If you do not
  know a local case that actually fits, use the one you do know rather than
  inventing a Taiwanese one.
- Cite the source inline, in the sentence that uses it:
  `[ERIC：原始政府報告 ED012275](https://eric.ed.gov/?id=ED012275)`. Never a
  reference list at the end of the card.

## Formatting

- Single newline between paragraphs; blank lines only where Markdown demands
  them.
- `##` only when a card spans multiple moments, and the heading names the
  moment (`## 1884 Ludwig Boltzmann 電磁學推導`). Single-moment cards have no
  headings. Never apply a uniform section template.
- Bullets only for genuine enumerations, each as `短標籤 ⇒ 說明`.
- Full-width punctuation: `⇒` `→` `～` `＆` `、`.
- Math: inline `$...$`, display `$$...$$`, `\begin{aligned}` for multi-step
  algebra. Verify LaTeX escapes survive transport — `\nu` and `\nabla` have
  been silently corrupted into newlines before.

## Text analysis: feeling → cause → evidence

Three steps, in this order, no skipping. Each claim about a text must survive
all three:

- **What do I feel?** ⇒ Name the direct reading response (grief, cruelty,
  absurdity…). No wrong answers — but it must be a *real* reaction, not a
  performed one.
- **Why?** ⇒ What did the author actually write that produced the feeling?
  This separates the text's craft from my own 腦補. If I can't answer, the
  feeling has no textual basis and doesn't go on a card.
- **Where?** ⇒ Point to the exact line, word, or passage. This is the
  load-bearing step: without a locatable quote, the first two answers are
  worthless no matter how elegant. Analysis is only credible when it stands
  on text evidence.

## Scope

Every board carries one **scope card**: what this board covers, what it
deliberately leaves out, and why. It is the only card exempt from the joint
rule. Both `改善專案領導的捷思法` and
`這張圖刻意不做完整 sociology canon⇒它保留一條可工作的選擇原則` are this card.

Write the exclusions honestly and specifically. 「本板不處理 X，因為…」 is the
most useful line on the board, because it is the only place the user can see
what was pruned and push back on it.

**How to decide what to leave out: do not prune by how close a thread is to the
topic.** Prune by whether it can form a joint with a card already on the board.
Topical relevance is the wrong filter — it kills everything two hops out, and
two hops out is usually where the value is. 奧運、麥當勞、Tesla、
AMD→台積電→日月光 are all off-topic for a book about megaprojects, and every
one of them is the 實例 that some argument card needed.

A thorough research board usually lands somewhere around 25~50 **claim cards**.
The scope card, hub cards and any other scaffolding do not count. **That is a
symptom, not a target.** Never split a card, and never add scaffolding, to reach
it.

- Landing far below usually means threads were pruned by topical relevance —
  check the scope card's exclusion list is honest.
- Landing at the top of the range with two-sentence cards is the opposite
  failure: the number was read as a target and the material was stretched over
  it. Fifty definitions is worse than twenty cards that each did some reading.

## Board layout

- **X is the spine, Y is the branch.** Left-to-right is the narrative
  (chronology, or 問題→診斷→方法→執行). Rows stacked in Y are parallel threads
  or a new era. On a board built from 時序 joints the X axis carries the
  relation itself, and arrows can be sparse.
- **A finished board is wider than it is tall.** If the Y span is the larger
  one, the board is a scroll: one thread running down the page with nothing
  beside it. That is the layout signature of a joint chain — fix the joints,
  not the coordinates.
- Placement is hand-made and load-bearing. Never run `arrange_cards` on an
  established board without asking. A newly created whiteboard is an
  exception. Always run it after a whole round of research.
- **The agent cannot create canvas text labels.** The user's own boards use
  tldraw text elements for section headings and grouping; the HTTP API has no
  endpoint that reads or writes them. Do not simulate them with arrows — that
  is what produces boards where every card is wired to every other and none of
  them mean anything. Instead:
  - a **hub card** carries a section heading — bare-label title, and the cards
    under it join to it as 組件.
  - a **nested whiteboard** (`create_whiteboard` with `parentWhiteboardId`)
    carries a branch that deserves its own surface.
- Because of this the agent's boards are sparser in arrows than the user's
  hand-made ones. That is correct, not a defect.
- Cards rely on position for context as well as on joints. A joint is required;
  a `contextboard:` reference to a card on *another* board is optional, and
  goes in the sentence making the claim.

## Anti-pattern: "AI wrote this"

A draft is wrong even when every fact is right. Rules stated as prose do not
bind; **pointing does**. Before submitting, pick two cards at random and do all
five exercises out loud. If you cannot point, the board is not finished, however
well it reads.

1. **Point at the 具名 anchor** — the person, year, titled work, place or
   figure. A hypothetical illustration is not an anchor.
2. **Point at the joint and name which of the five it is.** Then check the
   target: is it a card making a claim, or a section label?
3. **Delete the joint sentence and re-read.** If the card is just as good, the
   joint was decoration.
4. **Put the two cards side by side.** Same number of sentences in the same
   order? That is a template, and fifty of them is a form letter.
5. **Follow the joints from any card backwards.** Far fewer distinct targets
   than cards is a star; a walk that keeps going for ten or twenty steps is a
   chain. Both mean the target was defaulted, not chosen.

The tells:

- **Every joint pointing at the same few cards**, or at section labels — 星形.
- **Every joint pointing at the card written just before it** — 鏈. A board
  taller than it is wide is this failure seen from a distance.
- **A joint sentence repeated verbatim** across cards.
- **Cards with no proper noun in them** — no person, no year, no place, no
  work, no number.
- **Every card the same length and rhythm**: 反直覺開場 → joint → 收束句, two
  or three sentences, fifty times.
- **Cards that only announce what a section covers.**
- **Cards that never name each other**, all relation carried by arrows.
- **A reference tacked onto the closing sentence** — 「這與 X 相關」. It passes
  the arrow check while leaving the board disconnected, which makes it worse
  than no reference at all.
- **Arrows drawn to reach a count**, or to stand in for a section heading.
- Uniform `##` sections on every card, same template.
- A tidy closing paragraph restating what was just said.
- No `記得`/`注意到`/`btw`, no parenthetical asides, no colloquialism.
- Nobody in the story has a motive; no local example; no exact figure.
- Cards split by source document that overlap in ideas, or split to reach a
  card count.
