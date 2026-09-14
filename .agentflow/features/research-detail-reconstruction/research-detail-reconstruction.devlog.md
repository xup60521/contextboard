# STATUS

Project: contextboard

Notebook: .agentflow/features/research-detail-reconstruction/research-detail-reconstruction.devlog.md — stream.

Current commit: instruction implementation remains 1f30d00; trim assessment is notebook-only.

Tests/scenarios: read both instruction files and compared duplicate responsibilities; no code tests needed.

Configuration: .agentflow/features/research-detail-reconstruction/ag.json — schema v7; validated for codex this round.

Proven: specific consolidation opportunities and separate policy proposals identified.

Open: trimming is proposed, not applied.

Next: await owner direction on the proposed cuts.

Artifacts: none for A-002; earlier review retained.

Archived eras: none.

Streams: none.
---

# → Ask / A-001 (xup60521)

+ godev
  我想要調整research-flow 的邏輯，重點是detail note 要想要更放在重建作者的論述上
  這是我和AI討論的feedback
  ```
  對，我剛才把你的困難往「建立自己的知識架構」推得太多了。你真正問的是：**當文本難到連初步理解都生不出來時，AI 能不能協助你重建作者的論述？** 這時要求你先讀懂、寫三句再來討論，確實把最困難的部分留給你自己。

+ 我認為可以，而且這種情況適合讓 **AI 先提供一個可供對照的讀法，你再帶著它回到原文**。不必堅持自己先獨立理解，才有資格使用 AI。

+ 這種協助可以具體分成三種：

+ | 卡住的原因          | AI 應該協助什麼                         |
  | -------------- | --------------------------------- |
  | 句子太繞、翻譯腔重、指涉不明 | 拆開長句，標出主詞、代名詞指涉、轉折與限定條件，用白話重述     |
  | 缺少領域背景         | 補足理解這段必要的背景：作者在回應誰、反對哪種解釋、術語在此怎麼用 |
  | 每句似乎懂，合起來卻不懂   | 重建論證：問題 → 主張 → 理由，以及這段和前後文的關係     |

+ **關鍵是讓 AI「展開原文省略或壓縮的東西」，而不只是摘要。** 摘要往往把已經很濃縮的文本再壓縮一次；你需要的反而可能是把兩頁展開成四頁，讓中間的連接看得見。

+ 拿你提到的 Bourdieu 來說，你需要的未必是一份概念清單，而可能是：「為什麼作者在這裡突然引入這個概念？它解決了前面什麼困難？如果不用它，原本的解釋會漏掉什麼？」AI 的白話解釋也應該保留原文的限定，不能把一個有條件的論述改寫成順口的大道理。

+ 實際互動可以這樣走：

+ 1. **給 AI 一個完整小節，請它先導讀。** 說明這節在處理什麼問題，以及各段如何推進，不急著延伸到其他理論。
  2. **對照原文閱讀，針對落差追問。** 例如：「你說這段是在反駁前面的觀點，但我看不出來，哪些字句支持這個判斷？」或「這個例子怎麼支持他的結論？」
  3. **最後才由你重述，再讓 AI 校正。** 這時重述是確認理解是否成立，不是取得協助前的門檻。

+ 至於你原先擔心的「互動建立理解會不會太不確定」，真正需要防的是：**AI 講得很通順，但那套說法未必是作者的。** 因此可以要求它固定區分：

+ * 原文明確說了什麼。
  * 為了接起論證，AI 推測了什麼。
  * 為了幫助理解，AI 自己加了什麼例子或背景。

+ 如此，你不必在「自己硬讀」和「相信 AI 的完整解說」之間二選一。可以先借用它的解釋進入文本，再逐步檢查那個解釋能不能成立。**先有輔助、後能自己重建論述，也是合理的閱讀順序。**

+ ```

---

## [RUN-001] Event — 2026-09-14 15:02:38 +0800 (A-001)

- Route: direct, host implementation. Detail notes will reconstruct the author's argument, expanding difficult language and connections before asking the reader to restate it.

- Scope: skills/contextboard/research-flow.md and skills/contextboard/taking-note.md. Preserve coverage, quotations, locators, metadata fields and statuses, topology, synthesis, budgets, and publishing rules.

- Validate saved instructions against the feedback and existing contracts, then independently review operating instructions. No app runtime is needed.

- Stream research-detail-reconstruction is active. Root pointer is deferred to the laptop main-checkout session. Prior nonempty answers were handled in A-007.

## [RUN-002] Event — 2026-09-14 15:08:36 +0800 (A-001)

- Implemented the two instruction changes and inspected the saved diff; git diff --check passed.

- Targeted external review passed for 1f30d00df49260744b4d5a912e690e6e222ab126, using gpt-5.6-terra/high in an unchanged independent clone. Host inspection accepted the findings. The report's trailing stamp period is a presentation warning only.

- Preparation completed and pushed the stream branch. Close the stream for PR delivery; do not run finish --deliver.

- Closeout initially rejected the report framing. Preserved the raw report and created a clearly labeled normalized copy that changes only the trailing stamp punctuation and fills the empty boundary with host provenance. No review verdict or finding changed.

# ← Reply / A-001

* _2026-09-14 15:08:36 +0800 (codex/unknown)_

## [SUMMARY]

- Detail notes now prioritize rebuilding the author's reasoning for a reader who needs an initial explanation.

- The instruction change passed a targeted independent review and is pushed. PR creation follows this closing record; no existing board notes were regenerated.

## [FINAL REPORT]

1. Adjust research-flow so detail notes reconstruct the author's argument.

   - Succeeded in `skills/contextboard/research-flow.md` and `skills/contextboard/taking-note.md`. Start with a coherent section, unpack difficult sentences and necessary background, and explain why reasons, examples, and concepts advance the argument. An explanation may exceed the source passage's length.

   - Offer a provisional reading before asking the reader to restate it. Interactive follow-up checks the reading against exact wording; autonomous research does not wait for this exchange.

   - Visibly distinguish the author's statements, inferred connections, added examples or background, and unresolved readings. Preserve conditions and genuine gaps. Added material cannot establish the author's position.

   - Saved-diff inspection and `git diff --check` passed. The existing coverage, citations, metadata, source topology, synthesis, budget and publishing contracts remain intact. The independent review returned Outcome, Minimality, Conformance and Verdict PASS for `1f30d00`. Host inspection confirmed the cited requirements and no unrequested source changes. The review clone was unchanged.

   - Validation covers the instructions, not generated note quality. No app runtime, browser session, or board publishing was needed. The next real reading remains the practical quality check.

   - `agf finish --prep research-detail-reconstruction` completed and pushed the branch. The stream is closed for PR delivery, with merge and cleanup left to the laptop after review. Root notebook pointer updates are deferred to the laptop main-checkout session.


## Questions (batched — each with a suggested default)

- None.


---

# → Ask / A-002 (xup60521)

+ taking-note and research-flow is a little bit too bloated
  Is there anything worth trimmed off?

# ← Reply / A-002

* _2026-09-14 15:11:38 +0800 (codex/unknown)_

## [SUMMARY]

- Yes. The largest safe reduction is to give each rule one home. My previous patch added useful reading guidance but repeated it across both files.

- No instruction files were edited. The recommendations below separate deduplication from changes to workflow policy.

## [FINAL REPORT]

1. Identify worthwhile cuts in taking-note and research-flow.

   - Let `taking-note.md` own reading and source-note construction. Replace most of `research-flow.md` section 3 with the invocation, expected output, and research-specific requirements. Move its unique positioning and quotation guidance into taking-note before removing duplicates.

   - Merge taking-note sections 3, 4 and 8 around one section-reading procedure. They repeat what a complete argument contains and when to split or merge cards. Keep one explanation and a short acceptance checklist.

   - Give note topology one home in taking-note section 10. Research-flow should retain only the relationship between layers, their spacing, and synthesis-layer arrangement. Preserve title prefixes and machine-relevant layout rules.

   - Combine the four epistemic status definitions with the mixed-status prose rule in taking-note section 5. Keep visible distinctions between author statements, reconstructed connections, added aids, and uncertainty; remove the second enumeration explaining the same categories.

   - Cut repeated motivational prose about surplus notes, quotation currency, and why agents invent things. Keep operational rules and examples that clarify an actual edge case. The one-citation-per-note diagnostic is not evidence that notes were reverse-engineered and can go.

   - Keep one fidelity checklist in taking-note. Research-flow can name the second pass's scope and when to run it, without restating the checks. Removing the second pass altogether would be a separate policy change.

   - Policy changes worth considering: remove the approximately 40% single-source threshold and mandatory disagreement card per round; require comparison and disagreements where supported. Replace the automatic demotion after two mechanical failures with a bounded repair/report decision, because formatting failure does not make synthesis into a source note. These change behavior, so they are proposals, not silent deduplication.

   - Preserve the new core: coherent-section guidance, explanation of why concepts and examples enter, necessary background, help before user restatement, locatable evidence, qualifications, visible uncertainty, and explicit source coverage. The exact numeric tree limits can be debated separately; they are existing layout policy and should not disappear in a prose cleanup.

   - Recommended first pass: consolidate ownership, merge repeated instructions, and cut rhetorical justification. Keep the reading method explicit and make research-flow a short orchestration document. Inspection covered the two current files in the research-detail-reconstruction worktree; no generated-note evaluation was performed.

## Questions (batched — each with a suggested default)

- None.


---

# → Ask / A-003 (xup60521)

+
