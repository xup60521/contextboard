# STATUS

Project: contextboard

Notebook: .agentflow/features/research-detail-reconstruction/research-detail-reconstruction.devlog.md — stream.

Current commit: stream-open only, no code commits yet.

Tests/scenarios: none.

Configuration: .agentflow/features/research-detail-reconstruction/ag.json — schema v7; validated for codex this round.

Proven: the stream configuration was copied from the root configuration.

Open: none.

Next: reply to the first Ask below.

Artifacts: none.

Archived eras: none.

Streams: none.

Backlink: main notebook `.agentflow/devlog.md` (main checkout)

Feature: research-detail-reconstruction — active — Reconstruct authors arguments in detail notes

Opened by the `agf` shell shortcut on 2026-09-14, not by an agent round. The main-notebook `stream:` pointer line was deliberately NOT written — the next main-checkout session re-derives it from `.agentflow/features/*/*devlog.md`.

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
