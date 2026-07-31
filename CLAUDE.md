# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

**Skill precedence:** If an installed skill (e.g. `superpowers:brainstorming`) imposes a mandatory
gate — written spec, approval cycle, "MUST"/"HARD-GATE" language — before implementation, this
file's trivial-task exemption still applies and is not overridden by the skill's wording. A task
counts as trivial only if ALL of these hold:
- Touches a single file or a single well-understood location
- The desired outcome has no ambiguity — there's exactly one reasonable interpretation
- Requires no new architecture, dependency, data model, or interface decision

**Never trivial, regardless of the above:** any task touching a file or module that handles
personal/user data (PII), payment or financial flows, or security controls (auth, access control,
encryption, credential handling) — judged at the file/module level, not by whether this specific
change touches the sensitive logic. These always go through the skill's full process, no exemption.

If any of these is false, follow the skill's full process — don't invoke the exemption.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.




對話規則
　每次回答都可以直接指出我表達裡的問題，包括邏輯漏洞、認知偏差或是不成立的地方，可以直接指出
　對話回答請優先給我客觀中立的分析，不需要迎合我，不需要提供情緒價值	
　開發者語言偏好為繁體中文，與開發者對話文字請使用繁體中文，agent本身思考或跑流程的顯示不在此限。

檔案結構規則
　多頁面專案依類別分資料夾維護，資料夾內互連用相對檔名、跨資料夾連結统一寫相對路徑

工作流程：
　工作階段開始時，請agent告知開發者你是哪個模型，避免環境設定錯誤

  使用SUPERPOWER技能進行工作，如有疑問，與開發者討論

　工作開始前閱讀交接文檔Handover；工作日誌worklog不要整份讀取，改用日期／階段標題搜尋定位：首日（有完整計畫）及最近兩日工作階段的紀錄範圍，只讀該範圍內容；不要閱讀工作日誌全文及對話紀錄chatlog（文檔過大）。

　與開發者確認方案架構與機制完整再進行程式碼的編寫

　發生錯誤時，不可自行試錯虛耗token：無論是開發者回報「不正確」，或是agent自行執行程式碼、指令、驗證流程時遇到非預期、原因不明顯的失敗（顯而易見的單點語法錯誤除外，尤其是從未實際驗證過的程式碼），都必須立即停止，不可自行修改後重跑；須先列出可能原因，與開發者討論確認方向後，才能逐項檢查調整，不可預設錯誤來自程式碼本身。

　Debug階段更新完程式碼後，需要關閉SERVER再重開，不可只靠開發者reload或reload指令，避免server沒有載入新程式碼的環境問題.

　階段工作結束前，生成工作日誌worklog，簡要記錄當天日期，第幾個工作階段，當日工作內容、完成項目、遇到瓶頸、開發者交代備忘事項。（工作日誌簡單扼要，細節記錄在對話log）

　對話紀錄chatlog以逐字稿方式記錄，包含agent建議的選項內容以及開發者的選擇；不要留到收工時才一次生成，改成每個討論段落或決策點完成後就寫入該段落的逐字稿，避免長對話被系統壓縮導致早期內容失真；階段工作結束前檢查當次工作階段的所有段落是否都已寫入完整，非每一輪對話都要寫入。

　階段工作結束前，推送當日工作成果至程式碼倉庫，如未設定固定目標倉庫請詢問。

　如開發者未要求，不用更新Readme欄位內容。如要求更新Readme欄位，順序包含：DEMO按鍵(如果有完成的網頁)、專案目標、計畫架構(如果有)、已完成進度、未完成事項。

  階段工作結束前，確認本次session內自己啟動的本機測試用server並關閉；如果發現與本專案相關但非本次session啟動的殘留server（例如上次收工未關閉、或開發者自行另外啟動），列出來詢問開發者是否一併處理；與本專案無關的其他服務不主動掃描或處理，如果判斷不出某個server是否與本專案相關，一併列出詢問而非自行判斷。

　階段工作結束前，生成交接文檔Handover規則如下

生成上下文交接文件的規則：
　請將這份文件整理得精簡且具備高度機器可讀性
　請使用清晰的 Markdown 格式，並包含以下結構：
　專案目標 (Project Goal)： 一句話總結我們最終要完成什麼。
　已完成進度 (Completed)： 我們剛剛已經確認或做完了哪些事？
　目前的瓶頸或停頓點 (Current Blocker/Status)： 我們停在什麼問題上？或是目前卡在哪個細節？
　下一步行動 (Next Steps)： 下次重新開始時，第一件要做的事情是什麼？
　關鍵設定(Key Context & Rules)： 有哪些重要的變數、我們約定好的格式（例如特定框架、風格語氣、YAML 設定參數）或關鍵資料片段？
　

版面設計規則：
　如果方案有中英文版時，修改須同步執行中英文版本
　網頁版面設計注意頁面（欄位選項）底色與文字顏色的對比度，太過相近的顏色會辨識度差