# Tracker

## Identity

- **Work key:** A-001-card-library-selection.

- **Active Ask:** A-001.

- **Goal:** Virtualize the card library while preserving whole-set marquee selection and drag auto-scroll, with the toolbar fixed above the scrolling cards.

- **Last update:** 2026-09-07 18:05:00 Asia/Taipei.

- **Evidence commit:** cf098b5.

## Overall state

- **State:** active.

- **Reason:** Verification and substantive review pass; Git integration and PR filing remain.

- **Total:** 5.

- **Completed:** 4.

- **Remaining:** 1.

## Accepted task checklist

- [x] **T-1:** Add shared uniform-grid geometry and switch marquee hit-testing to arithmetic content-space boxes, without adding dependencies or keyboard/range-selection behavior. Proof: focused geometry and existing marquee tests pass 34 of 34 with the toolbar case included. Source: A-001 and the committed root A-001 design sections 3-4.
- [x] **T-2:** Window card rendering by whole rows against the existing app scroll host while retaining every filtered id as selection scope. Proof: focused tests cover bounded DOM rendering, off-screen marquee selection, and selection persistence across scrolling. Source: A-001 and the committed root A-001 design sections 6-8.
- [x] **T-3:** Add edge-triggered drag auto-scroll with complete animation cleanup, without changing card activation or toolbar operations. Proof: focused tests cover the animation step and the owner manually confirmed the real app works. Source: A-001 and the committed root A-001 design section 5.
- [ ] **T-4:** Run the relevant checks, substantive external cross-check, host gate, commit, push, and file a non-draft PR while preserving unrelated work. Proof needed: command output, PASS review, exact Git state, pushed branch, and PR URL. Source: A-001 and Agentflow completion contract.
- [x] **T-5:** Keep the card-library toolbar visible while cards scroll, without changing its controls or visual hierarchy. Proof: focused sticky-boundary test passes and the owner manually confirmed the real app works. Source: A-001 owner follow-up, "the top section should not scroll".

## Accepted scope changes

- Change: added T-5. Source: A-001 owner follow-up. Effect: the toolbar stays visible while the card grid scrolls.

## Current recovery

- **Current item:** T-4.

- **Last proven result:** Focused card-library and geometry tests pass 34 of 34; web-ui typecheck passes; owner manual journey passes; Codex full cross-check passes Outcome, Minimality, and Conformance for `cf098b5`.

- **Active blocker or running process:** None.

- **Next safe action:** Record the host gate, commit review records, verify the remote branch, push, and file the PR.

- **Expected changed files:** packages/web-ui/src/components/cards/cardGridGeometry.ts; packages/web-ui/src/components/cards/cardGridGeometry.test.ts; packages/web-ui/src/components/cards/useUniformGridWindow.ts; packages/web-ui/src/components/cards/useCardLibrarySelection.ts; packages/web-ui/src/components/cards/CardGrid.tsx; packages/web-ui/src/components/cards/CardLibraryPage.tsx; packages/web-ui/src/components/cards/CardLibraryToolbar.tsx; packages/web-ui/src/components/cards/CardLibraryPage.test.tsx; .agentflow/features/a-002-card-library-selection/a-002-card-library-selection.devlog.md; .agentflow/features/a-002-card-library-selection/artifacts/A-001-card-library-selection/*.

## Completion proof

- **All accepted tasks checked:** no.

- **Blocking accepted decision:** none.

- **Operation running:** no.

- **Next action remaining:** T-4.

- **Evidence status:** current.

- **Judgment:** active.

## Update meaning

- Saving this tracker is a recovery checkpoint, not a stop signal.

- Work continues with the next unfinished item unless an independent stop condition applies.
