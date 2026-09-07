# Agentflow — 白話使用手冊

[English](AG_GUIDE.md) · **繁體中文**

這一頁用日常語言解釋 agentflow 怎麼用，並附上例子。它假設你從來沒用過這套系統。給 AI 看的規則書放在 `SKILL.md`；你完全不需要讀那個檔案就能使用整套系統。

## 這一頁一直會用到的協定與三條工作路線

- **流程（protocol）** — 平常的工作方式：AI 會維護一本筆記本檔案。新專案使用 `.agentflow/devlog.md`；沒有 `workspace-dir` 的舊專案在明確搬移前仍使用專案根目錄的 `devlog.md`。AI 把每一個請求和每一個答覆都寫進這本筆記本，並隨時保持更新。不管工作多小，都適用。

- **direct route（直接路線）** — host AI 自己處理清楚、可復原、容易測試，而且不跨越重大風險邊界的本機工作。不會只因為有 worker 可以使用，就把這些工作交給別人。

- **selected-advisor route（選定 advisor 路線）** — AI 只執行用來回答具名重大問題的 advisors；直接工作無法安全處理那些問題。

- **full-pipeline route（完整 pipeline 路線）** — 對於難以復原、跨越信任邊界、一般測試可能藏住嚴重失敗，或有啟用的明確 trigger 的工作，執行完整 requirements、適用時的 brownfield discovery 和 codewalk、specification、implementation、security 與 acceptance 流程。

## 一切背後只有一個核心概念

- **你和 AI 透過一本筆記本檔案交談，而不是透過終端機。** 新專案的檔案是 `.agentflow/devlog.md`；專案根目錄的 `devlog.md` 只屬於尚未明確搬移的舊格式。

- 你把請求寫進筆記本。AI 做完工作後，把答覆寫進同一本筆記本、你的請求正下方。你們兩邊說過的每一句話，都留在頁面上。

- 為什麼用檔案而不用終端機：終端機會忘記，檔案會記得。每個決定、每個問題、每個結果都存進 Git（版本控制系統，會保存檔案的每一版歷史），所以你隨時、在任何電腦上，都能回頭讀完整段歷史。

## 開始使用 — 一個字

1. 在終端機打開你的專案資料夾，啟動 AI（例如執行 `claude`）。

2. 輸入一個字 `godev`，按下 enter。

3. **在一個專案裡第一次使用時：** AI 只執行一次 `agf init`。這一個指令會建立 `.agentflow/devlog.md`、專案根目錄的 `ag.json`、三個忽略項目，以及專案安全 hooks。它絕不會替你建立 Git repository。`ag.json` 是唯一的啟動設定來源，告訴 Agentflow 私有工作區的位置。公開控制詞使用 kebab-case（單字之間用連字號）：`target-doc: .agentflow/devlog.md`、`workspace-dir: .agentflow`、`cli-provider: off|on`、`auto-reply: on`、`lang: en`、`streams: ask|always|off`、`ask-names: off`、`allow-ag: on`、`metrics: off` 和 `large-work-minutes: 120`。

		AI 會在使用設定前讀取並驗證 v7 `ag.json`（`"schema-version": 7`）。公開 JSON 和設定請求使用相同的 kebab-case 名稱；舊拼法會被拒絕，不會自動轉換。

	檔案最下方還會留一個空的「Ask」（提問）區塊。那個空區塊就是你下一次輸入請求的地方。

	它還會問你一個小問題：「這個專案要用什麼簡短代號？」— 見下面的「幫專案取個小名」一節。

	**如果你的資料夾還沒被 Git 管理**（Git 是保存檔案每個版本的存檔系統，有它在，任何東西都不會弄丟），AI 會多問一個問題：「要幫你設定好嗎？」建議答案是「要」— 有了 Git，每一輪工作都會被安全存檔，就算程式中途當掉，AI 也能靠存檔找回完整經過。它絕不會不問你就自己動手設定。

4. **之後的每一次：** `godev` 的意思就是「去看筆記本，然後繼續」。AI 會用一次小型本機檢查讀取 STATUS、最新未完成請求、目前 branch、已修改檔案名稱和驗證過的設定。它不會在給第一個有用回答前從網路抓資料、讀舊 archive 或重裝 hooks。

## 幫專案取個小名 — 讓你隨時知道自己在哪本筆記本裡

- **這個功能解決的問題：** 當你同時在好幾個專案裡工作時，每本筆記本都叫 `devlog.md`，長得一模一樣。很容易打開錯的那本，把請求寫進錯的專案。

- **筆記本第一次建立時，AI 會問你一個問題：** 這個專案要用什麼簡短代號？它會建議用專案資料夾的名字當預設值，所以回答「yes」就夠了。

- **你的答案會永久存在筆記本最上方的 STATUS 區塊裡。** 長得像這樣 — 一個簡短的英文代號，加一行你喜歡的任何語言的描述：

	```
	Project: ag — agentflow 技能與它的使用手冊
	```

- **隨時可以改**：在請求裡用日常語言講一聲就好，沒有特殊語法要學。

## 筆記本可以改名 — 做到一半也行

- **這個功能解決的問題：** 上面的專案小名要打開檔案才看得到，但編輯器的分頁列上還是五個一模一樣的 `devlog.md`。如果你想讓檔名本身就說出這是哪個專案，就幫筆記本改名。

- **怎麼改名：** 在請求裡任何位置寫一行 — `target-doc: ag.devlog.md` — 填上你想要的新名字。AI 先單獨提交筆記本和封存檔的搬移，再在第二個提交中更新旁邊的 `ag.json`、建立轉寄卡、更新 STATUS，並在答覆裡用「舊名 → 新名」跟你確認。這個兩提交順序會保留完整歷史。

- **建議的命名形狀：專案代號放前面，保留 `devlog` 這個字。** 例如 `ag.devlog.md` 或 `shop.devlog.md`。編輯器分頁一眼就能分辨，而且任何人瞄一眼資料夾，仍然認得出這是一本筆記本。

- **那新開的工作階段跑去找 `devlog.md` 怎麼辦？** AI 會在舊地址留一張一行字的轉寄卡，就像搬家後郵局留的轉址通知：`Moved to: ag.devlog.md — write your asks there.`（已搬到 ag.devlog.md — 請去那裡寫需求。）新的工作階段找到卡片、照著走，就接上真正的筆記本。它絕不會在你改名後的筆記本旁邊再建一本空的。

- **如果有人不小心把請求寫進轉寄卡裡**，它一樣會被回答 — AI 會把文字搬進真正的筆記本，並註明這個小插曲。任何請求都不會遺失。

- **提到舊名字的舊頁面維持原樣。** 它們是歷史，歷史永不改寫。筆記本的 STATUS 區塊會多一行紀錄這次改名，像 `Renamed: devlog.md → ag.devlog.md (2026-08-14)`。

## 每句話都要打 `godev` 嗎？

- **不用。每個工作階段只要打一次。** 工作階段（session）指的是你在終端機裡跑 AI 程式的一次執行。第一次打完 `godev` 之後，筆記本協定在整個工作階段都保持開啟 — 你接下來說的每句話都在協定下處理，並記錄進已設定的筆記本。

- **開新的工作階段時才要再打一次** — 開新的終端機視窗、重新啟動程式、或清除對話之後。還是同一個字，而且它同時代表「從上次停下的地方繼續」，所以工作階段之間不會遺失任何東西。

- **專案裡已經有已設定筆記本的話，連第一次都不用打。** 新專案使用 `.agentflow/devlog.md`；舊專案在搬移前可用根目錄 `devlog.md`。只要這個已設定檔案存在，AI 從你的第一句話開始就自己把協定打開；沒有已設定筆記本時，在你打出 `godev` 前不會留下紀錄。

- **`nolog` — 只讓一句話不留紀錄。** 在訊息裡任何地方放上 `nolog` 這個字（或講白話「這句不要記」「off the record」），那「一句話」就只在終端機回答你：不寫進筆記本、不修改 `ag.json`、也不存進版本歷史。下一句話又恢復正常記錄 — 這是刻意的設計，沒有「整個工作階段都關掉記錄」這種用法。有一條安全規則永遠不會被放寬：如果這一輪真的改了檔案、存進了版本歷史、或上傳了東西，那還是一定會被寫下來，並且附上一句「你要求了 nolog，但這次做不到」。文字紀錄絕對不可以跟磁碟上真正發生的事情對不上。

- 第一次 `godev` 之後，你有兩種說話方式，兩種都可以：

	- **直接在終端機打字。** 你可以在第一次送出 `godev` 時，把請求放在同一則訊息裡；AI 開始時，已設定筆記本可以完全沒有改動。AI 先完成那次小型唯讀檢查，再把你的完整訊息原樣寫進最後的空 Ask，接著做工作並把答覆記在同一輪。

	- **直接寫進筆記本。** 新專案打開 `.agentflow/devlog.md`，把請求寫進最下方的空 Ask 區塊，存檔，然後在終端機打 `godev` 或 `continue`，意思是「我寫了東西 — 去讀」。

		- **這種尚未 commit 的 Ask 是正常輸入。** 如果只有已設定筆記本改變，而且只是從最後的空 Ask 變成你的新請求，Agentflow 會把它當作你的預期輸入，不會誤認成另一個人或另一個 AI 同時工作。

		- **先給有用回答。** AI 完成小型本機檢查和這個請求需要的證據後，會先給直接答案或說明下一個實作步驟；之後才做較慢的測試、archive、commit 和 push。最後的 `devlog.md updated` 只是完成訊號。

## 一輪對話長什麼樣子

- 你的請求會拿到一個編號，像 `A-007`。AI 的答覆出現在正下方，標著同一個編號。一個請求加一個答覆，稱作一輪（round）。

- 當 AI 需要你做決定時，它絕不會在工作中途打斷你。它把一般問題收集在答覆的最後面，每個問題下面寫一個建議答案，再留一行空白像這樣：

	```
	- ans:
	```

- 你把答案打在 `ans:` 後面，存檔，打 `godev`。AI 讀了你的答案就繼續工作。如果你同意它的建議，回答一個「yes」就夠了。需求工作有一個很窄的例外：尚未回答的需求問題會把唯一的 `- ans:` 欄位留在筆記本指定的精確需求報告路徑；新配置的工作使用 `requirements-report.md`，既有工作沿用先前記錄的路徑。筆記本只告訴你該路徑與尚未回答的問題編號，不會複製問題內容。

## 十個設定 — 它們是什麼、怎麼看、怎麼改

設定、`pipeline-roles` 與 `external-workers` profiles 放在筆記本旁邊、通過 v7 驗證的 `ag.json`。STATUS 只顯示設定檔路徑、版本、runtime host 和驗證狀態。

- **怎麼看：** 打一個字 `settings` — AI 會重新讀取並驗證旁邊的 `ag.json`，列出版本、runtime host、外部 CLI 可用性、合法值，以及精確的修改語法。

- **怎麼改：** 在你的請求裡任何位置寫一行像 `auto-reply: on` 的字。AI 會先驗證整批修改，再用原子方式寫入 JSON，並在答覆裡用「舊值 → 新值」的形式逐項確認。

- **每個設定的意思：**

	- **`target-doc`** — 哪個檔案是筆記本。新專案的預設值是 `.agentflow/devlog.md`；舊專案若沒有 `workspace-dir`，仍會使用原本的根目錄路徑。你很少需要親手改它；下面介紹的團隊功能會幫你管理。

	- **`workspace-dir`** — Agentflow 自己的筆記本、archive、artifacts、streams 和 planned queue 放置的單一安全相對路徑。新 round 不再建立獨立的 audit side file；完成檢查會從 Git 與目前的 review 證據推導決定。舊 audit 檔案保留為不修改的歷史。新專案預設是 `.agentflow`。已存在的專案不會在一般使用時搬移任何檔案；要明確搬移已追蹤的舊根目錄紀錄，請先確認 Git 工作樹乾淨，再執行 `agf settings migrate-workspace`。目標已存在、設定不相容或有未追蹤的 Agentflow 紀錄時，指令會拒絕而不搬移。

	- **`lang`** — AI 書寫時用的語言（答覆、文件、提交訊息都算）。預設值是 `en`。要改就寫一行像 `lang: zh-TW`。

	- **`auto-reply`** — AI 可不可以自己回答自己提出的例行問題、不等你就繼續工作？新專案預設 `on`，它採用安全的建議答案繼續做；既有專案會保留目前儲存的值。`off` 表示每個問題都等你。但有四件事不管怎麼設都一定停下來等你：只有主人能做的決定、無法復原的事、會透過新管道離開你機器的事、超過約定花費上限的事。

	- **`ask-names`** — 每個請求的標題要不要顯示是誰寫的？`off`（預設值）只顯示編號，像 `# → Ask / A-018`。`on` 會加上提問者的名字，像 `# → Ask / A-018 (John)` — 好幾個人共用同一本筆記本時很有用。AI 會優先用你在請求裡自己說的名字；沒說的話用你的 Git 名字；最後才用電腦的登入帳號名。

		- **`cli-provider`** — delegated work 使用哪個 CLI 家族的單一開關：`off` 固定使用主機家族，`on` 允許使用另一個可用家族。兩者都只透過 unified external worker 執行。


			- 設定檔只驗證固定執行檔是否可用，不能提供命令路徑或 shell 片段；選定家族不可用時，記錄限制並停止或使用明確允許的 fallback。

	- **即時 RUN 事件** — 每次工作有重要變化時，Agentflow 會在 devlog 追加一個有編號的事件，例如路由選擇、任務結果、測試、關卡、失敗或中斷後恢復。它不會記錄每一條指令。WIP 仍是每十個 active minutes 寫一次的完整進度說明。舊 runlog 檔案只保留為歷史，不會搬移、刪除或繼續讀寫。

	- **`streams`** — 出現功能或平行工作訊號時，AI 要怎麼處理。`always` 會直接開 stream；`ask` 會先用 yes/no 問題確認；`off` 只會告訴你這個訊號，不會問你要不要開 stream，也不會自己開 branch 或第二個資料夾。`off` 不會隱藏檔案歸屬或同時工作的安全問題。你直接寫 `new-feature: <名稱>` 時，AI 仍會開啟你明確要求的 stream。

		- **`allow-ag`** — 是否可以啟動 complex pipeline 工作？合法值是 `on`、`off` 和 `ask`。`off` 會阻止 complex route；`ask` 需要 owner 確認。Simple job 在任何設定值下都可以直接產生 plan。

	- **`metrics`** — 是否寫入可選的本機 metrics history？合法值是 `off` 和 `on`。evidence window 是命令列選項，不是設定。

	- **`large-work-minutes`** — 預估 active work 超過多少分鐘時改走大型工作路線。預設值是 `120`；合法值是 1 到 10080 的整數。

- **缺少設定檔：** 已建立的筆記本若缺少 `ag.json`，系統會用清楚的修復訊息停下，不會從 STATUS 文字建立設定。新的設定檔必須透過明確的初始化或修復動作建立。

## 公開名稱、advisor 選擇與安全實作規則

### 用 `cross-check` 要求一次獨立實作審查

當你希望 Agentflow 在回報完成前，先讓一位外部 reviewer 檢查最後實作時，就在 Ask 裡加入 `cross-check`。這裡的實作包含你要求修改的程式碼、測試、設定和給使用者看的文件。`cross-check` 不是 `ag.json` 設定，也不會啟動完整 pipeline。

Agentflow 會從已凍結的變更檔案清單、變更行數、是否改變行為、是否碰到信任邊界，以及是否屬於廣泛變更，自動選擇合比例的 review 等級。`narrow` 只檢查小型純文件差異和具名契約，不重跑無關的完整測試。`targeted` 檢查一般行為修改並重跑聚焦測試；協調者已通過的完整相關測試可以直接作為證據，不必由 reviewer 再跑一次。`full` 用於廣泛、高風險或信任邊界修改，reviewer 會重跑完整相關測試。擁有者可明確要求 `stronger`，讓等級提高一級。目前 Ask 內精確的 `skip-review: <接受這項取捨的原因>` 可省略任何等級的這一次最終獨立 review，並留下擁有者接受此選擇的原因。它不會跳過測試、交付檢查或重大工作的批准關卡。

外部 reviewer 只能讀取實作、執行檢查並寫自己的報告。報告必須針對最後實作 commit，分別給出 `Outcome`、`Minimality`、`Conformance` 的 `PASS` 或 `BLOCKING`，再給整體 verdict。這會把「是否達成 Ask」、「每個新增概念是否必要」和「是否符合既定契約」分開判斷。任何必要 verdict 缺漏、格式錯誤或是 `BLOCKING` 都會阻止完成。如果審查後又修改實作，舊報告立即失效，必須重新審查新的最後 commit。

完成的 Reply 會記錄 `Cross-check review: <repository-relative report path>` 和 `Cross-check implementation: <40-character commit hash>`。報告必須放在目前 Ask 的 work key 裡，用 `Reviewed implementation commit: <40-character commit hash>` 記錄同一個 hash，使用標準 worker 開頭時間戳，並以唯一一行 `Self-check:` 結束。檢查器會拒絕不安全路徑、symbolic link、無法讀取或格式錯誤的報告、多個 verdict、`BLOCKING`，以及不相符的 commit。報告內有效但與可信派工紀錄不同的 model 或 effort 標籤只會顯示警告，不會要求付費重跑。檔案文字本身無法證明作者，所以 coordinator 仍會另外驗證外部 worker 真的有執行。

如果 Ask 本來就使用完整 `ag` pipeline，而且 mandatory external acceptance 報告檢查的是同一個最後實作 commit，它可以直接滿足 `cross-check`。Agentflow 不會再啟動一個重複 reviewer，也不會替 requirements、codewalk、explore、spike、spec、security、acceptance 或 learn 各自增加一次 cross-check。

### 用 `3ways` 辯論重大計畫

只有在計畫需要獨立的實作前辯論時，才在請求裡放 `3ways` 或 `threeways`。Agentflow 會凍結原始 Ask、一般使用者旅程、最小設計、新增概念、不確定處、禁止範圍和待答問題，再進行一次唯讀外部審查。host 是 `brain_1`；`brain_2` 優先使用不同模型家族中合格且最高優先序的 `better` worker；若只能同家族 fallback，會如實記錄限制。

重大工作的設計計畫固定存成 `<work-root>/design.md`。`plan-NNN.md` 只保留給 looper 可執行工作佇列使用。

每一輪都保存不可變的 brief、report 和 host-resolution 紀錄。只有證據已驗證、沒有重大歧見，而且有 `Consensus: AGREE` 才算同意。開始三輪後，或只有擁有者能選擇時，紀錄會寫 `Consensus: UNRESOLVED`。辯論不會授權實作：你仍要給 `Design Go: <plan commit>` 或 `Design Stop: <reason>`。重大實作在交付前還需要通過旅程、三個 cross-check verdict、host gate，以及 `Result Go: <implementation commit>`。

如果你必須在這兩個關卡前離開，請在目前 Ask 放入完全相同的一行 `away: gates`。它只允許 Agentflow 在該輪所有正常檢查都通過，而且 commit 完全相符後，代為套用 Design Go 和 Result Go。它不會核准未知工作、模糊的離開文字、失敗的檢查、變更過的範圍、較晚出現的 Stop、無法復原的動作，或新的對外管道。

下面是使用者可以輸入或看到的公開控制詞。請完全使用連字號形式。

- `new-feature: <name>` 開啟功能 stream。

- `merge-back` 從功能 worktree 關閉 stream。

- `target-doc: <path>` 指定筆記本路徑。

- `workspace-dir: <relative-path>` 指定 Agentflow 私有工作區；它不會自動搬移舊紀錄。

- `cli-provider: <value>`、`auto-reply: <on|off>` 和 `ask-names: <on|off>` 修改相應設定。

- `allow-ag: <on|off|ask>` 和 `metrics: <off|on>` 修改相應設定。

- `keep-going` 讓目前已核准的工作清單繼續執行，直到清單完成。

- `all-in` 要求目前請求使用完整 pipeline。

- `cross-check` 不啟動完整 pipeline，但會要求一位外部唯讀 reviewer 對目前請求的最後實作給出 `PASS`。

- `3ways` 和 `threeways` 要求實作前的計畫辯論；兩者都不會授權實作。

每個 worker profile 必須有 `best`、`better`、`basic` 和 `cheap` tier，也可以加入通過驗證的 custom tier；所有 delegated work 都使用 unified external worker。

所有實質研究、規劃、實作、文件草稿、掃描和第一次審查都使用 unified external worker。Coordinator 只保留擁有者對話、安全邊界、獨立驗證、最後判斷、Git 整合和交付。

公開的 `pipeline-roles` 名稱是 `requirements`、`codewalk`、`explore`、`spike`、`spec`、`implementation`、`security-scan`、`acceptance`、`cross-check` 和 `learn`；每個名稱選擇一個已設定的 tier 或 `off`。`cross-check` 使用相同的 worker 選擇規則，但仍是實作完成後的獨立檢查，不是完整 pipeline 的一個 stage。

沒有第二套底線命名的設定 schema。未知的公開 key 會顯示 warning 並忽略；缺少認可的 key 或認可 key 的值/型別錯誤仍然會失敗，也不會做 alias、翻譯或 migration。

### 只選需要的 advisors

一個 work item 可以選擇要執行的 advisors：

```text
advisors: requirements, codewalk, spec
```

完整且固定的八個名稱是 `requirements`、`codewalk`、`explore`、`spike`、`spec`、`security-scan`、`acceptance` 和 `learn`。

- 逗號周圍的空白會忽略。

- 每個非空 token 都必須完全符合 roster 裡的一個名稱。

- 重複的有效名稱會去重，所以同一個 advisor 只會被選一次。

- 空的選擇、空 token 或未知名稱會在任何 advisor 啟動前停止路由，並回報完整 roster 和需要修正的值。

這一行會在 route dispatch 以及任何 advisor 啟動前解析。值必須是逗號分隔的字串。token 周圍的空白會忽略。空值、只有空白、空 token、尾逗號、非字串值、未知名稱或大小寫不符都會拒絕，並回報錯誤值和完整 roster。解析後保留首次出現的順序，再移除重複值。

輸入順序是選擇的證據，不是強制執行順序。相依安全的 route 可以先執行必要的前置 advisor；selected-advisor route 至少必須提出一個具名的 material question。`advisors:` 只決定可以派出的 advisor，不能繞過相依性或 coordinator 的責任。

例如 `advisors: requirements, spec, requirements` 會凍結成 `requirements, spec`。重複值會移除，第一個出現的值仍在前面。沒有 `advisors:` 行時，會使用一般 route 選擇。

驗證完成的選擇會在第一個 advisor 啟動前，凍結到 controlling brief 和執行記錄裡。使用者明確改變選擇時，會建立不可變的 amendment，記錄新的選擇以及它取代的前一份 brief 或 amendment。舊的 brief、amendment、選擇和執行記錄都不會改寫。

工作因當機、復原或遺失對話上下文而繼續時，Agentflow 會先讀取最新的不可變 brief 或 amendment，再決定路由。它不會因為一般預設值遺失就把省略的 advisor 加回來。只選 `requirements` 時，先執行 requirements advisor；在報告被接受且完成必要的 owner sign-off 後，coordinator 直接執行其餘已授權的實作和驗證。

advisor 選擇只改變「誰被派出」。它不會移除測試、證據、sign-off、Git 工作、隔離、artifact 檢查，或 coordinator 的驗證與回報責任。

### 正式修補與測試先行

每一個可執行的行為變更或 bug 修復，預設都採用 red-first 測試驅動開發。

1. 先新增或修改表達所需行為的自動化測試。

2. 在修改 production code 前執行測試，並記錄預期的失敗。

3. 確認失敗原因是行為尚未存在或已損壞，不是 fixture、語法、環境或測試設定錯誤。

4. 做出能讓測試通過的最小 production 修改。

5. 再執行 focused test，並記錄通過結果。

6. 執行完整的相關測試套件，並記錄結果。

純文件工作不會改變可執行行為，因此可以省略最初的失敗測試。機械式的正式 artifact 修補也可以省略，但修補記錄必須說明原因、指出權威替換來源、證明限定範圍的 byte 變更，並重新執行完整 artifact gate。

coordinator 只能修補固定的正式 span，而且替換內容必須已由不可變權威或已驗證的執行證據決定。例如標準開頭 stamp、精確的必要標題、精確的路徑標籤或精確的最後 boundary。記錄必須寫出 defect、來源和 span；比較修改前後的 bytes；證明授權 span 以外的每一個 byte 都沒有變；再執行完整 gate。若 defect 會改變 finding、決策、結論、證據意義或 self-check 判斷，就必須退回負責的 advisor。

### 大型工作與 review 的界線

只有在請求不連貫，或預估的 active work 超過已驗證的 `large-work-minutes` 時，Agentflow 才使用大型工作路線；預設門檻是 120 分鐘。只有 coordinator 能看的 master plan 必須記錄完整 outcome、排序後的 items、dependencies、ownership、progress 和最後的 integration check。queue 一次只接一份 self-contained、可以獨立檢查的 plan；不會接到 controller 的私有狀態。連貫的普通工作留在普通路線。

大型工作的執行順序固定如下：

1. controller 可以先寫一份私有的 master outline，用來看清整體工作。這份草稿不能授權 implementation 開始。

2. 一位 requirements advisor 先為 owner 的完整請求建立一份共用 requirements report。

3. 既有產品一定記錄 discovery。只有遇到陌生程式碼、多個子系統、公開介面、儲存資料、信任邊界，或缺少目前有效的 map 時才執行 codewalk。有 trigger 時，只有同一筆被接受且目前有效的 codewalk record 同時帶有明確的 shared-coverage marker、目前的 codewalk evidence、已回答的問題，以及 verified paths、fact/inference labels、public boundaries、conventions、likely edit locations、focused commands 和 unexamined areas，才可以同時滿足兩個邏輯義務。沒有 trigger 時，保留小型 discovery record，不要 dispatch codewalk。

4. 一位 specification advisor 把已接受的 requirements 和 repository 證據整理成一份共用的 implementation contract。

5. 到這一步之後，controller 才凍結可以執行的 `plan-NNN.md`。每份 plan 負責共用 contract 中一個有邊界的部分，並且包含精確的 Authority、Outcome、Dependencies、Required work、Constraints、Tests and evidence、Completion conditions、Success signal 和 Final integration sections。

6. plan 依照 dependency 順序一次執行一份。每份 plan 不會各自重新跑完整的 requirements 流程。

7. 如果某份 plan 發現缺少決定或決定互相矛盾，該 plan 必須停止。controller 先修正受影響的共用 requirements 或 specification，之後才繼續。

8. 所有 plan 完成後，controller 會把合併結果對照 owner 最初的完整請求，做最後一次整合檢查。

`make-plans` 會逐項把 owner job 分成 simple 或 complex。它直接發布 self-contained 的 simple plan；complex plan 仍使用已接受的 requirements、specification 和 permission gate。如果 complex 工作被阻擋，只有在它和 simple 工作彼此獨立時，才可以發布只包含 simple job 的 truthful partial queue。`make-plans` 只在發布這份有 digest 綁定的 frozen queue 後停止。它不會啟動 implementation。之後的 execution 會透過一般 unified external-worker route 使用相同的 frozen plan bytes 和 completion contract。

估計的 active time 和實際的 active time 要分開記錄。超過十個 checkpoint 時，要顯示 warning 並評估拆分；這是軟界線，不是自動失敗。剛好十個 checkpoint 還沒有越界。

新的或修改過的 checkpoint 中，`Finished` 和 `Running now` 都要在外層分點下方使用編號清單。如果沒有剩餘工作，必須精確寫成 `- **Still to do:** None.`；如果還有工作，`Still to do` 使用相同的編號清單格式。外層分點後空一行，每個編號項目縮排兩個空白，從 `1.` 開始，而且每個項目後都要有空行。最後一行必須是 `[x] tracker.md | [x] devlog RUN | [x] scope matches tracker`。這些勾選只聲明目前檔案已包含這個 checkpoint 的事實，不聲明已 commit 或 push。Tracker 的更新時間不能早於 checkpoint，而且前一個 RUN 事件必須記錄實際變更路徑與 tracker 範圍的比較。整輪完成前仍然要照正常規則 commit 和 push。`scope matches tracker` 只表示控制 AI 已留下這份範圍比較；Stop hook 不能證明設計本身有必要。

每個 review stage 即使改名，也要保留同一個 identity。啟動 worker 前，要檢查 working directory、test access、executable 和 authentication。如果即時 fact 不可取得，先請使用者補充並記錄 SKIP。process 或 model 尚未啟動前可以有一次免費失敗；之後的每次失敗都要計入，同一個 stage 最多只能啟動三個 worker。達到這個固定上限後保留 unresolved 結果並停止 automatic cycle；AI 不可以自己決定再啟動第四次。

Security 只做一次 advisory pass。data loss、destructive behavior、credential exposure 和 central-requested behavior failure 要交給 owner/controller 決定；其他 finding 記成 follow-up。Acceptance 把 owner 看得到的 behavior 和 record quality 分開記錄；security 或 acceptance 都不會自動開 repair loop。

寫給 owner 的文字要用白話清楚說明技術邊界、實質結果、限制、決定和下一步。

每個完成的 substantial round 都必須在 `## [SUMMARY]` 後面立刻放置 `## [FINAL REPORT]`。這份報告必須可以單獨閱讀。它要重新說明所有最終結果、失敗、決定、限制，以及 owner 需要採取的行動。純 short-answer round 可以豁免。

當一個 Ask 內有多個請求時，Reply 必須依照 owner 提出請求的原始順序回答。每個請求都要有一個清楚分開的群組。群組先簡短重述原始任務或問題，再提供答案和相關證據。如果是任務，必須說明工作是成功、失敗，或仍有限制，並解釋遇到的問題。

### 保留較早的輪次

早於目前 live round 的完成輪次，都是從 `# → Ask / A-NNN` 到下一個對應 Ask 邊界的完整 physical span。把原始 bytes 不變地依時間順序複製到唯一相鄰的 `<basename>.archive.md`，先核對 identifier 只出現一次、byte length 和 SHA-256，通過後才移除 live 裡同一批 bytes。遇到 collision、source replacement 或不確定的邊界時，保留所有已驗證的副本並停止。`Archived eras:` 只能是 `none` 或該相鄰 archive path，不能放 era label、range、batch 或 human index。STATUS 下方要緊接目前輪次，檔案結尾要保留下一個空的 Ask scaffold；先寫 Reply，再寫最後的 STATUS projection。

### Frozen planning queue

`make-plans` 發布精確編號的 plan 和有 digest 綁定的 `.queue-generation.json` envelope，然後在 implementation 前停止。v2 envelope 會記錄每份 plan 是 simple、complex 或 final integration，並把 simple plan 綁定到 owner request 和 repository evidence，把 complex plan 綁定到已接受的 contract。Envelope 才是 execution authority；缺少、改變、不完整或矛盾的 queue evidence 都會被拒絕。Queue publication 不會建立本機 ownership、attempt、recovery 或 stop-state machine；之後的 executor 透過一般 unified external-worker completion contract 讀取 frozen bytes。

### 依序執行你自己寫的 plans

獨立的 `looper.js` 指令可使用你自己撰寫的 queue，也可直接使用 `make-plans` 發布的完整 artifact `planned/` 資料夾。手寫 queue 只需把名稱符合 `plan-NNN.md` 的檔案放在工作項目的 `planned/`；自動產生的 queue 則必須讓 plan 與 `.queue-generation.json` 保持在一起。接著執行 `node skills/agentflow/scripts/looper.js --tasks-dir <planned-資料夾路徑>`。它會從 owning notebook 相鄰的 `ag.json` 之 `external-workers` 清單選擇可用指令，等到 notebook 出現完全符合規則的完成證據後，才把該 plan 移到 `done/`，再執行下一個可執行的 plan。對 generated queue，frozen envelope 的 completion path 會決定 owning notebook 與設定檔，因此 stream queue 會使用 stream 相鄰的 `ag.json`；它還會綁定 envelope 與每個 plan 的 digest、遵守 dependencies，並透過共用的 `select_frozen_ready_plans` boundary 選擇 ready plan。普通 host agent 也必須呼叫同一個 boundary，因此兩條路徑會接受相同的 frozen authority，並在所有 terminal job 完成後才執行唯一的 final-integration plan；明確指定但衝突的 completion path 會被拒絕。generated Codex worker 會在啟動前建立僅 owner 可讀寫的 final-message object，立即移除它的 pathname，並只把繼承的 `/dev/fd/3` reference 交給 child；完成證據只能來自保留的匿名 descriptor，且必須通過有界、穩定與嚴格 UTF-8 的讀取，因此 pathname substitution 不存在，而 growth、truncation、超限內容及 noisy stream 都不會被接受。它直接在目前 checkout 工作，因此不是隔離的 external-worker route；沒有 envelope 的手寫 queue 仍維持原本行為。

## 全力以赴 — 用 `all-in` 要求一件工作跑完整流程

- **它解決的問題：** 面對小工作，AI 是被允許抄捷徑的 — 跳過選配的檢查步驟、縮減文書 — 這樣你就不必為一行小修改付出整套儀式的成本。但有時候一件工作「看起來」小，實際上很重要，你希望每個檢查都跑、每份文件都寫，完全不准抄捷徑。

- **怎麼要求：** 在你的請求裡任何位置放上 `all-in` 這個詞。例如：「go `all-in` on this job：幫發票頁面加一個刪除按鈕。」連字號就是它成為指令的關鍵 — 一般英文句子裡的 "all in" 兩個字不會有任何作用，所以日常語句永遠不會誤觸它。

- **這個詞要求 AI 做的事，一條不少：** 跑完整開發流程；不可以提議或採用任何捷徑路線；每個選配的檢查步驟都要跑（風險探索、技術實驗、安全掃描、經驗教訓記錄）；每個必跑步驟都不准縮水 — 全深度執行，留下完整文件。

- **為什麼說「要求」而不是「保證」。** 這些是 AI 讀了以後遵守的規則，不是一台會攔住它的機器。每一輪結束後在外面跑的那個檢查器只看記錄本身 — 時間戳、終端機那一行、有沒有謊稱上傳、答覆的格式 — 目前並不會去驗證「每一個開發階段真的都跑過了」。實測中，一個較弱的模型在 `all-in` 之下確實守住了「哪份文件該由誰寫」這類重要規則，但仍然漏掉好幾條文書規則。所以這個詞買到的是「強很多的流程」，而你自己讀那些文件，仍然是最後一道檢查。

- **它只涵蓋那一個請求。** 下一個請求回到平常模式，由 AI 依工作大小決定力道。事後沒有任何設定需要關掉。

## 一個人一次做一件事 — 什麼都不用特別做

- 直接把你想要的東西寫進筆記本。例如：

	```
	+ 請做一個把字串反轉的小工具，附測試。
	```

- AI 規劃、實作、測試、回報 — 全都在筆記本裡。這件工作完成後，較早的輪次會壓縮到筆記本唯一相鄰的 archive，目前輪次仍保持可見，主筆記本也保持簡短好讀。

## 一個功能的一生 — 從開始到永久紀錄

在讀細節之前，先看一個功能從頭到尾的完整旅程，讓你知道每個階段為什麼存在。

1. **你打開它** — 一行字，`new-feature: login-page`（或在終端機打 `agf new "login page"`）。系統會建一條分支（一條平行的歷史線，不會干擾任何人的工作）、在磁碟上建一個第二個資料夾（這樣兩個 AI session 才不會互相蓋掉對方的檔案）、再在那個資料夾裡建一本該功能自己的筆記本。從這一刻起，你關於這個功能說的每一句話、AI 的每一個回答，都住在那本筆記本裡，不在主筆記本裡。

2. **你在裡面工作** — 跟在主筆記本裡工作完全一樣。打 `godev`，寫請求，讀答覆。AI 知道該用哪本筆記本，因為它會檢查你在哪條分支上。

3. **你收掉它** — 在功能資料夾裡先執行 `node <skill-dir>/scripts/agf.js finish --prep [taskkey]`，寫好並 commit 收尾紀錄；若有 `origin`，也先 push 該紀錄，再執行 `node <skill-dir>/scripts/agf.js finish --deliver [taskkey]`。交付只接受原始 committed blob：必須是有效 UTF-8、使用一致的 LF 或 CRLF、沒有不允許的控制位元組或孤立的 carriage return，並且只有一行完全 byte-exact 的 `Feature: <名稱> — closed`。CLI 會在每次修改 default ref 前重新確認 stream branch 和 tip，並只 push/merge 那個已驗證的 commit。若人在主資料夾，則用 `node <skill-dir>/scripts/agf.js cleanup [taskkey]`（或由使用者執行 `agf cleanup`）。CLI 負責 Git 的準備、交付和既有清理；筆記本、STATUS、root 指標和收尾紀錄仍由 AI 寫入。

   交付時會在主 checkout 的 Git common directory 建立一個短暫、獨佔的 `agf-delivery.lock` 檔案。檔案會記錄負責程序、加密安全的隨機 owner token 和復原資訊；CLI 會保留 descriptor/stat identity，清除前驗證 pathname identity 與 token，所以不會刪掉替換後的 lock。如果無法證明 ownership 或 unlink 失敗，交付會回傳非成功、完全不輸出成功用的資料夾路徑，並誠實說明 remote/local Git 交付是否已完成、部分完成或結果未知。這個 lock 只會排隊 Agentflow 的交付；手動執行的 Git 指令不會遵守它，所以交付期間不要同時手動切換分支、merge、fetch 或 push。如果程序已停止，先查看 lock 裡的記錄，再移除失效的 lock。

4. **筆記本永遠留著** — 新專案在 `.agentflow/features/login-page/login-page.devlog.md`，跟著程式碼一起併進你的主線。一年後，任何人都可以打開它，讀到當初為什麼做了某個決定、測試了什麼、過程中出了什麼差錯。程式碼告訴你「做了什麼」；筆記本告訴你「為什麼這樣做」。

- **這一切的代價：** 一個分支名稱、一個資料夾（都是暫時的），加上每個功能一個小小的文字檔（永久的）。不做的代價：兩個終端機默默蓋掉對方的檔案，而且沒有任何紀錄說明為什麼東西是這樣蓋的。

## 同時做多個功能、或團隊合作 — 筆記本會自己分家

整個功能用一句話講完：**當好幾件工作同時進行時，每件工作會拿到自己專屬的筆記本、放在自己的資料夾裡，而新專案的主 `.agentflow/devlog.md` 變成一張目錄，指向所有這些筆記本。**

你永遠不用建資料夾，也永遠不用學任何路徑規則。實際用起來像下面這樣。

- **例子：** 你和一位隊友共用一個專案。你在自己的 Git 分支（branch，可以想成專案的平行副本，做完再合併回來）上做登入頁；隊友在另一個分支上做搜尋框。

- **第一步 — 說你要開始做哪個功能。** 在主筆記本（或終端機）打一行：

	```
	new-feature: login page
	```

	講白話也可以 — 「我要開始做登入頁，隊友同時在做搜尋」意思一樣，AI 會把上面那一行提回來給你確認。就算你完全沒提到平行工作，它也會自己注意到跡象（你正在功能分支上，或已經有另一件工作在進行中），然後用一個 yes/no 問題問你要不要。

- **第二步 — AI 把一切建好。** 它透過 `node <skill-dir>/scripts/agf.js new "<name>" [taskkey]` 開分支、建立 `.worktrees/<taskkey>`、寫入該功能自己的筆記本並完成第一次存檔。CLI 不寫 root STATUS 指標；AI 會在 stream notebook 留下空的下一個 Ask，並給你恰好一行現成續接指令：`cd '<absolute-worktree-path>' && <current-host-cli>`。路徑必須是解析後的絕對 worktree 路徑，而且保持 shell 引號。沒有任何主機會搬移目前的 session；這個指令不可用時，AI 會明說原因，不能退回自行拼接 Git 指令。

- **第三步 — 你照原本的方式繼續交談。** 在你的分支上，你只要打 `godev`。AI 會檢查你在哪個分支，自己打開正確的筆記本。你永遠不用記路徑。如果它真的無法確定你指的是哪件工作 — 比如同一個分支上有兩件工作 — 它會問你一個問題，而不是亂猜。

- **不小心寫錯檔案？沒關係。** 你寫在哪裡，AI 就在哪裡回答，並且指出這個小錯位。請求絕不會因為打錯地方而遺失。

- **合併（merge）那天 — 沒有任何事要做。** 你的筆記本和隊友的筆記本住在不同資料夾，所以 Git 把它們並排合起來，完全不衝突。合併之後，AI 會更新主筆記本裡的目錄，把兩件完成的工作都列上去。

- **團隊固定都這樣工作的話：** 在任何請求裡寫一行 `streams: always`。它就是一個普通設定，上面的設定清單已經完整說明過，它只改變一件事：AI 要不要先問你。

- **不管那個設定是什麼值，你永遠知道現在用的是哪一本筆記本**，來源有三個：每一輪結束時 AI 在終端機印的那一行，寫的就是它剛剛更新的檔案路徑；主筆記本的 STATUS 列出每一本進行中的筆記本和它的位置；在某個分支上打 `godev`，AI 會自己打開那個分支的筆記本。

## 開始做新功能時，需要開新分支或 worktree 嗎？

簡短回答：**通常不用。** 分支、worktree、獨立筆記本是三個各自獨立的工具，每一個都是可用可不用。下面說明每個工具是什麼、什麼時候才值得用。

- **一個人一次做一件事 — 直接寫下願望就好。** 待在原地，把請求寫進筆記本，就這樣。不用分支、不用 worktree、不用獨立筆記本。功能完成後，較早的輪次留在筆記本唯一相鄰的 archive，目前輪次保持可見。

- **分支（branch）** 是同一個專案裡的一條平行歷史線。在分支上做的工作不會干擾任何人，直到你把它合併回來；功能做壞了也可以便宜地整條丟掉。當工作是實驗性的、會做很久的、或和別人的工作同時進行時，才需要開分支。

- **獨立筆記本（stream devlog）** 讓一個功能的對話住在自己的檔案裡。恰恰是「兩段對話會在同一個檔案裡混在一起」的時候才需要它 — 也就是平行工作的情況。做功能時，你不會單獨去要它，也永遠不用打路徑：下面那一行 `new-feature: <名稱>` 會連同其他東西一起把筆記本建好。（如果是一段永遠不會產生程式碼的對話，你「可以」只要筆記本 — 見下面的逃生門。）

- **worktree** 是磁碟上的第二個實體資料夾，顯示同一個專案的另一條分支。沒有它，切換分支時你唯一的資料夾裡的檔案會來回替換；有了它，兩條分支同時攤在磁碟上、各占一個資料夾。它只在兩種情況下真正有用：你想在主資料夾繼續自己的工作、同時讓 AI 工人在另一個資料夾蓋新功能；或者你在兩件工作之間切換得太頻繁、檔案不停替換讓你受不了。除此之外它只是多餘的重量 — 多一個要記得的資料夾，而且很容易在錯的資料夾裡打指令。delegated worker 改在沒有 remote 的獨立拋棄式 Git clone 裡執行；功能 worktree 是 owner/session 的工作空間，不是 worker 的安全籠。

- **把上面全部濃縮成一行：`new-feature: <名稱>`。** 當你想給某個功能自己的空間時，不用打一長句描述它 — 在筆記本或終端機打一行就好：`new-feature: login page`。AI 會呼叫 `node <skill-dir>/scripts/agf.js new "login page"`；CLI 開分支、開 worktree、開功能筆記本並完成第一次存檔，AI 再補 root 指標和輪次紀錄。沒有東西要記，也沒有路徑要打。講白話也可以 — 「我們來做登入頁」會得到同樣的東西，只是會先用一個 yes/no 問你（設了 `streams: always` 就直接做）。

- **為什麼只有這一行，沒有更輕量的版本。** 你可能會預期還有一個比較小的指令，只開獨立筆記本、不開分支也不開第二個資料夾。刻意沒有做那個指令，理由有三個。第一，這一行本來就會把筆記本開好，所以比較小的指令不會多給你任何東西。第二，兩個長得很像的指令會逼你在最糟的時機做選擇：你當下想的是功能本身，不是工具；如果你選了小的，一小時後又開了第二個終端機，不會有任何警告 — 兩個 session 就這樣默默蓋掉對方的檔案，看起來像工具的 bug，其實是一小時前選錯了一個字。第三，兩種選錯的代價完全不對等：不需要卻用了這一行，代價是多一個分支名稱、伺服器上多一個參照、磁碟上多一個隱藏資料夾，還有事後一行清理指令 — 小、看得見、收得回來；需要卻用了輕量版，代價是真的工作被蓋掉。真正會互撞的是磁碟上的檔案，不是筆記本，而只有第二個資料夾能把檔案分開。所以只留一行，而且留的是安全的那一行。

- **真的只想要一本筆記本的話，講白話還是拿得到。** 在筆記本或終端機說**「幫這件事開一本獨立的 devlog」**，新專案會得到剛好一個新檔案 `.agentflow/features/<名稱>/<名稱>.devlog.md`：同一個資料夾、同一條分支，什麼都不搬、什麼都不開分支、也什麼都不上傳。任何意思相同的講法都算，而且你永遠不用打路徑。這適合用在「永遠不會產生程式碼」的對話 — 看文件、研究某個問題、想把規劃討論從主筆記本裡拉出來。只要會產生程式碼，就改用 `new-feature: <名稱>`。

- **第二個資料夾放哪裡：一律是專案裡的 `.worktrees/<名稱>`。** `agf new` 或 AI 的同一個 CLI 呼叫會建立它。所有主機都使用同一個流程：目前的 session 不會被任何主機搬移；AI 會給 owner 恰好一行 `cd '<absolute-worktree-path>' && <current-host-cli>`，其中是解析後的絕對路徑且保持 shell 引號，並提醒先 `/exit`。不可把「已準備好」寫成「已搬移」。

- **口訣：** 一個人、一件接一件 → 直接寫願望，其他都不用。只要是平行的 — 真人、第二個終端機、或背景的 AI 工人 — → 一行 `new-feature: <名稱>`。不確定自己屬於哪一種時，就用 `new-feature: <名稱>`，因為那個錯的代價你看得見、也收得回來。

- **你自己要開第二個 AI 終端機（多終端機的情況）：** 兩個活著的 AI session 絕不能共用同一個專案資料夾 — 那正是它們互相蓋掉對方檔案的方式。在專案裡任何位置打開新終端機，打一行 `new-feature: <名稱>`；AI 會呼叫 `node <skill-dir>/scripts/agf.js new "<名稱>" [taskkey]`，留下自己的 worktree、筆記本和一次初始存檔，再給你恰好一行 `cd '<absolute-worktree-path>' && <current-host-cli>` 的續接指令。路徑是解析後的絕對路徑且保持 shell 引號；沒有任何主機會搬移目前的 session。先離開目前 AI（`/exit`），再把那行貼進純終端機；如果目前主機沒有可用的 CLI 路徑，AI 會明說並停止，不能自行改寫 Git 指令。兩個 session 的檔案和筆記本因此分開，主 session 的未完成內容也不會被第二個 session 順手接走。

- **要收掉那個終端機 — 功能做完了，併回去：** 在功能 worktree 裡，AI 先呼叫 `node <skill-dir>/scripts/agf.js finish --prep [taskkey]`。準備成功後，AI 寫入並 commit 關閉的 STATUS 和收尾 Reply；若有 `origin` 也先 push 該紀錄，再呼叫 `node <skill-dir>/scripts/agf.js finish --deliver [taskkey]`。目前或舊版 stream 筆記本必須是乾淨 stream HEAD 上的 regular committed file，原始 blob 必須是有效 UTF-8、使用一致 LF 或 CRLF、沒有不允許的控制位元組或孤立 carriage return，並含有唯一且完全 byte-exact 的 `Feature: <名稱> — closed`，且和 `origin/<名稱>` 相同。交付前會重新確認 stream branch/tip，並只用已驗證 commit；遇到新加入路徑會覆蓋的未追蹤或 ignored 項目時，CLI 會拒絕；遠端 default branch 已推送後才拒絕，會明確標成部分交付。若 lock release 被拒絕或 unlink 失敗，CLI 會回傳非成功、不輸出資料夾路徑，並誠實回報 Git 的部分結果。需要清理時，交付成功後再呼叫 `node <skill-dir>/scripts/agf.js cleanup [taskkey]`。CLI 不寫筆記本、不刪分支或 worktree；那些紀錄和決策由 AI 負責。若腳本不存在，AI 會報出路徑並停止，不會改用直接 Git 指令。

- **在主資料夾裡收尾 — 一行 `cleanup: <名稱>`。** 呼叫可以來自主 checkout 或相符的 worktree；解析出主 checkout 後，主 checkout 本身必須位於 default branch。AI 會呼叫 `node <skill-dir>/scripts/agf.js cleanup [taskkey]`，由 CLI 執行既有的保護、合併和清理流程；AI 再把結果寫進主筆記本並把 stream 指標標成已結束。CLI 不寫 protocol prose，遇到未儲存工作、衝突或刪除拒絕時會如實回報，不會強制清除。fetch 或 default branch push 失敗時會在任何 sweep 前以狀態 1 停止，保留 worktree 及本地/遠端 stream ref；單一 sweep 拒絕則回報並繼續安全的後續步驟。你也可以用 `agf cleanup`、`agf clean` 或 `agf merge` 直接執行同一個清理實作。

- **不透過 AI，自己在終端機動手 — `agf new`、`agf finish`、`agf cleanup` 和 `agf ditch`。** 上面講的都是「跟 AI 講話」。另外還有一個指令是你直接打在終端機裡的，開、準備/交付、收、丟各用一個子指令，適合你已經很清楚自己要什麼、不想為了機械性的流程特地啟動一次 AI 對話的時候。它是一個小小的函式，只要在你的 `~/.zshrc` 檔案裡貼上一次就好 — 要貼的原文放在 `skills/agentflow/scripts/README.md`。

	- **`agf new "login page"` 幫你開這個功能。** 它會驗證主專案的 `ag.json`、開分支、開第二個資料夾、在新專案把設定檔複製到 `.agentflow/features/login-page/ag.json` 並保留直接的 `target-doc` 設定、寫好固定格式的功能筆記本、把第一次存檔上傳，然後讓你的終端機直接站在新資料夾裡面。你在那裏啟動 AI、打 `godev` 就能接著做。名字如果不是英文，後面要自己補一個英文 key — `agf new 搜尋頁 search-page`；另外加 `-m "..."` 可以把你的第一個請求直接寫進新筆記本，AI 一打開就有事情可以做。筆記本的完整路徑會獨立印成一行，大多數終端機都可以讓你 cmd-click（或 ctrl-click）直接打開。

	- **讓 `agf new` 自動用你的編輯器打開筆記本 — `AGF_OPEN`。** 只要在你的 `~/.zshrc` 裡加一行 — 例如 `export AGF_OPEN="code"`（VS Code）、`subl`（Sublime Text）、或 `open`（用 Mac 預設的 `.md` 開啟程式）— 以後每次 `agf new` 跑完，它就會順便用那個程式幫你打開筆記本。萬一那個程式起不來，你只會看到一行警告，其他一切照常運作。如果沒加這一行，什麼都不會變 — 跟今天的行為一樣，外加那行可以點擊的路徑。

		- **`agf finish` 幫你準備和交付這個功能。** 在功能資料夾裡依序打 `agf finish --prep login-page`、寫入並 commit 關閉紀錄（若有 `origin` 也先 push）、再打 `agf finish --deliver login-page`。關閉紀錄必須是 regular committed file，原始 UTF-8 bytes 使用一致 LF 或 CRLF、沒有不允許的控制位元組或孤立 carriage return，且只有唯一、完全 byte-exact 的 `Feature: login-page — closed`，同時存在於乾淨的 stream HEAD 和 `origin/login-page`；交付會重新確認 stream tip/branch 並鎖定已驗證 commit，交付前新加入路徑的 ignored 或未追蹤碰撞會被拒絕。準備階段不輸出資料夾；交付成功才會把主資料夾路徑輸出給 shell；release 失敗則回傳非成功且不輸出資料夾。需要清理時，再打 `agf cleanup login-page`；`agf clean` 和 `agf merge` 是同一個清理實作的別名。

			- **如果準備階段回報 merge conflict，程式已經取消那次 merge。** 留在功能 worktree。先查看 default branch 哪些修改和功能內容衝突。在功能 branch 上編輯或整合出你真正要保留的合併結果，然後 commit。再次執行 `agf finish --prep login-page`。不要執行 `git merge --continue`，因為程式已經 abort，沒有未完成 merge 可以繼續。準備成功後，才寫入並 commit 關閉筆記；若有 `origin` 就 push；最後執行 `agf finish --deliver login-page`。不要直接跳到 deliver。

		- **`agf cleanup` 幫你收掉這個功能。** 你人在功能資料夾裡面時直接打 `agf cleanup`，它會自己認出是哪一個功能；你已經回到主資料夾時就補上名字 — `agf cleanup login-page`。它保留保護和合併式清理；fetch 或 default branch push 失敗時會在 sweep 前停止，單一 sweep 拒絕則回報並繼續安全步驟，最後讓你站回主專案資料夾；CLI 不寫 protocol prose，下一輪 `godev` 會補上主筆記本紀錄。

	- **`agf ditch login-page` 幫你把這個功能整個丟掉。** 用在你改變主意、完全不想要這個功能的時候：它什麼都不合併。它會先列出即將刪掉的東西 — 那個多出來的資料夾（連同裡面沒存檔的工作）、伺服器上的分支、你磁碟上的分支 — 然後問你 `are you sure? (Y/n)`；按 Enter 或 `y` 才會動手，其他任何回答都是「什麼都不動」。名字一定要自己打出來，所以你刪掉的就是你打的那一個。跟 `agf cleanup` 不同的地方是：沒存檔、沒合併的工作會真的永遠消失 — 這正是這個指令存在的目的。

	- **每個子指令都是「寧可拒絕，也不亂猜」。** 遇到下面幾種情況，`agf cleanup` 會停下來、而且什麼都不動：你的主資料夾停在錯的那條線上（它會把「該怎麼走過去」那一行指令給你）、你打的名字它不認得（它會列出最接近的幾個名字，因為你很可能只是打錯字）、功能資料夾裡還有沒存檔的工作（它會把檔案列給你看）。萬一合併時真的撞在一起，它會把那次合併整個退掉，而且什麼都不刪。

	- **換到新電腦時，** 先用安裝程式建立一次 `agf` 捷徑。之後執行 `agf setup` 檢查捷徑，或執行 `agf setup --fix` 更新捷徑。它依序檢查 `$HOME/.agents/skills/agentflow`、`$HOME/.codex/skills/agentflow` 和 `$HOME/.claude/skills/agentflow`。新增捷徑時使用第一個完整位置；既有的 Agentflow 捷徑只要指向其中任何一個完整位置就算有效，即使縮排和產生的範例不同也不會誤判。這同時支援 `npx skills add` 建立的共用安裝、直接裝進 Codex 或 Claude 的方式，以及它們的 alias。

	- **這些子指令唯一不做的事，是幫你寫主筆記本**，因為一支小程式沒辦法判斷一篇日記該怎麼寫。所以不管用了哪一個，事後在主資料夾打一次 `godev`：下一輪 AI 會自己去看資料夾和分支、推算出剛剛發生了什麼事，然後把紀錄補寫上去。晚一點再寫不會漏掉任何東西。

	- **什麼時候該改用 AI 的那幾個字。** `new-feature: <名稱>`、`merge-back` 和 `cleanup: <名稱>` 都會把 protocol 紀錄寫好；AI 會用固定的 CLI 呼叫完成機械流程，並依序處理 stream notebook、root STATUS 和收尾輪次。直接打 `agf new`、`agf finish` 或 `agf cleanup` 只做 CLI 負責的部分，下一輪 `godev` 再從 Git 和 notebook 狀態重建紀錄。若腳本不可用，AI 會報告並停止，不會改用直接 Git 指令。

## 目前哪些 AI 模型跑得動 agentflow — 由設定檔決定

- **目前路由由 `ag.json` 決定。** 每個 pipeline stage 從 `pipeline-roles` 取得 built-in 或 custom tier；完整模型識別字和 effort 只從驗證過的 worker profile 讀取。

- **所有受測模型都成立的模式：** 安全行為沒有失效；每個模型都拒絕藏在專案檔案裡的惡意指令，也都在只有人類能做的決定前停下。主要差異是記錄品質，尤其是終端機只能印一行的規則。

- **預設 role routing：** `best` 用於高風險檢查；`better` 用於 requirements、specification 和 acceptance；`basic` 用於 implementation；`cheap` 用於最低重要性的工作或手動 quota probe。`pipeline-roles` 可以選 custom tier 或把 optional stage 設成 `off`。

- **本機驗證和實際可用是兩件事。** 本機只檢查模型格式、effort、家族和執行檔。登入狀態、帳戶權限、額度和真正的模型存取權，等到實際 dispatch 時才檢查。

## 歷史模型測量 — 只供參考

- **Claude 訂閱的歷史證據：** 保存的評估資料夾記錄了當時使用的模型與分數；它們不是目前路由指引，目前選擇以驗證過的 `ag.json` tier 為準。

- **Codex 訂閱的歷史證據：** 保存的評估資料夾記錄了當時使用的模型與分數；它們不是目前路由指引，目前選擇以驗證過的 `ag.json` tier 為準。

- **Ollama 本機模型的歷史證據：** 舊評估筆記只描述一次本機模型執行。把它視為過去的測量，不是目前支援的 tier；dispatch 前要用設定規則驗證新的識別字。

## 只記四件事的話

- 每個工作階段打一次 `godev`；新專案把請求寫在 `.agentflow/devlog.md` 或直接寫在終端機都行，看你喜歡。

- 一般問題在筆記本的 `- ans:` 那行回答；尚未回答的需求問題則在筆記本指定的精確需求報告路徑中回答（新配置的工作使用 `requirements-report.md`，既有工作使用先前記錄的路徑）。一個「yes」就代表採用建議。

- 打 `settings` 看十個開關；用一行像 `auto-reply: on` 的字改任何一個。

- 只要功能是平行進行的 — 有別人、有第二個終端機、或有背景的 AI 工人 — 就打一行：`new-feature: <名稱>`；做完之後在主資料夾打 `cleanup: <名稱>` 收尾。一個人按順序做，什麼都不用特別做。
