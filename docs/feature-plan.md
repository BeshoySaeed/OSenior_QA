# Feature Plan: Web Quality Inspector

## 1. Product outcome

Build a testing workspace that evaluates a URL, route, or isolated web component in three complementary ways:

1. **Visual testing** — compare the rendered UI with a baseline screenshot or Figma frame.
2. **Functional testing** — execute user journeys and report broken behavior with traceable evidence.
3. **Accessibility testing** — combine automated checks with keyboard, focus, and semantic validation.

The result is one actionable report: each finding has a severity, evidence, affected selector/component, source/Figma reference when available, and a suggested next action.

## 2. Users and primary jobs

| User | Job to be done |
| --- | --- |
| Designer | Confirm that the implementation matches the approved Figma frame across screen sizes. |
| Developer | Reproduce and fix visual, interaction, and accessibility defects quickly. |
| QA engineer | Run repeatable checks on a route or component and retain test evidence. |
| Accessibility reviewer | Identify WCAG issues and distinguish automatic failures from items requiring review. |

## 3. Scope and boundaries

### In the first release

- Test a public/local URL and a component story or preview URL.
- Capture screenshots at configured desktop and mobile viewports.
- Use an optional Figma frame as a visual reference through the Figma MCP integration.
- Inspect DOM, console errors, network failures, and runtime page state.
- Run automated accessibility scans and keyboard/focus checks.
- Execute authored functional flows: click, type, select, wait, assertion, and screenshot.
- Produce a shareable HTML/JSON report and a CI-friendly pass/fail result.

### Explicitly out of scope for v1

- Replacing full end-to-end test frameworks or manual accessibility audits.
- Auto-fixing production code.
- Pixel-perfect comparison across different fonts, OS rendering engines, or unknown loading states.
- Testing authenticated systems without a user-provided safe login/session setup.

## 4. Product workflow

```text
Configure target + evidence sources
          |
          v
Open page/component in controlled browser
          |
          +--> collect DOM, console, network, screenshots
          |
          +--> run functional flow
          |
          +--> run accessibility scan + keyboard checks
          |
          +--> fetch Figma frame / inspect source code (optional)
          v
Normalize and correlate findings
          |
          v
Rank, annotate, and publish report / CI status
```

## 5. Core user journey

1. User creates a test run and supplies a target URL or component preview URL.
2. User selects viewports, a baseline screenshot and/or Figma frame, and an optional functional-flow file.
3. The runner waits for a deterministic ready signal, blocks or masks known dynamic regions, and captures evidence.
4. Visual comparison identifies layout, color, typography, spacing, and content differences.
5. Functional steps run in order and capture screenshots, DOM snapshots, logs, and a trace on failure.
6. Accessibility checks scan the page, validate keyboard navigation and visible focus, and group results by WCAG criterion.
7. The report de-duplicates related failures and links them to DOM selectors, source locations, and design nodes when possible.
8. The user triages findings as open, accepted, ignored-with-reason, or fixed; CI fails only according to configured thresholds.

## 6. Proposed system design

### Frontend: test configuration and results workspace

- Run creation form; target, viewport, design reference, auth profile, masking, and thresholds.
- Finding list with filters for test type, severity, viewport, WCAG level, and status.
- Evidence panel with before/after/diff overlay, DOM snippet, browser trace, source reference, and Figma node link.
- Accessible interface itself: keyboard-operable, semantic, and screen-reader labeled.

### Orchestrator

- Creates immutable run records and queues one job per target/viewport.
- Applies timeouts, retry rules, concurrency limits, and secrets redaction.
- Aggregates test outputs into normalized findings and assigns final run status.

### Browser runner

- Use a real browser automation engine such as Playwright.
- Capture screenshots, DOM snapshots, ARIA snapshots, console logs, request failures, performance timing, and traces.
- Enforce deterministic conditions: viewport, color scheme, locale, reduced motion, frozen clock if supported, and network-idle/ready-state policy.

### Analysis adapters

- **Visual adapter:** baseline pixel diff plus Figma-rendered-reference comparison. Support masks, tolerance, and region-level comparison.
- **Functional adapter:** declarative flows plus optional scripted extensions. Assertions include visibility, text, URL, attribute, enabled state, and no uncaught errors.
- **Accessibility adapter:** axe-core or equivalent automated rules, computed contrast checks, landmark/headings/language validation, and keyboard/focus traversal.
- **Source adapter:** maps selectors or component names to repository files/lines when source access is available.
- **Figma adapter:** retrieves frame metadata, image export, dimensions, styles, and node IDs via MCP; never assumes design intent from pixels alone.

### Storage and integrations

- Store run metadata, findings, and user triage in a database.
- Store screenshots, diffs, traces, and exported reports in object storage.
- Export JSON/JUnit/SARIF for CI and issue trackers.
- Keep Figma MCP and source-code access behind least-privilege connector interfaces.

## 7. Data model (minimum)

| Entity | Essential fields |
| --- | --- |
| Test suite | id, name, targets, viewports, thresholds, schedule/CI configuration |
| Test run | id, suite id, commit/branch, started/finished time, environment, status |
| Artifact | id, run id, type, viewport, URL, storage URL, checksum |
| Finding | id, run id, category, severity, title, selector, status, fingerprint |
| Evidence | finding id, screenshot/diff/trace/DOM/log reference, timestamp |
| Design reference | Figma file/frame URL, node id, export size, revision/hash |
| Test flow | suite id, ordered steps, assertions, preconditions |

## 8. Delivery phases

### Phase 0 — foundations (1 week)

1. Confirm supported targets: local development server, preview deployments, Storybook, or all three.
2. Choose automation engine, database, artifact storage, and authentication approach.
3. Define test configuration schema and report JSON schema.
4. Set up a small fixture site containing intentional visual, functional, and accessibility defects.

### Phase 1 — browser evidence and functional MVP (2 weeks)

1. Build the test-run API and job queue.
2. Implement browser launch, target navigation, readiness policy, screenshots, logs, and trace capture.
3. Implement declarative flow steps and core assertions.
4. Build run history and failure evidence view.
5. Add JSON and JUnit export plus a CI command that returns a non-zero exit code on configured failure.

### Phase 2 — accessibility (1–2 weeks)

1. Integrate automated rule scanning and normalize results to findings.
2. Add WCAG tags, rule documentation links, impact/severity mapping, and known-issue suppression with expiration.
3. Implement keyboard traversal, focus-visible detection, focus-order evidence, and modal focus-return checks.
4. Add accessible-name, heading hierarchy, landmarks, document language, and skip-link checks.

### Phase 3 — visual baselines and Figma (2 weeks)

1. Add screenshot baseline approval/versioning and pixel-diff overlays.
2. Add dynamic-region masks, threshold controls, and viewport-specific baselines.
3. Integrate the Figma MCP adapter for selected frame exports and node metadata.
4. Align Figma frame scaling to viewport and record design revision used for every run.
5. Detect and label likely environment noise separately from real regressions.

### Phase 4 — source correlation and triage (1–2 weeks)

1. Add optional repository indexing/source-map lookup.
2. Link finding selectors/components to files and lines with confidence labels.
3. Add triage states, comments, ownership, and issue-tracker export.
4. Add baseline approval permissions and audit history.

### Phase 5 — hardening and rollout (1–2 weeks)

1. Test cross-browser behavior and browser-version pinning.
2. Load-test concurrent runs and enforce retention policies.
3. Complete threat model, secret handling review, and privacy review.
4. Pilot on 2–3 representative projects; tune thresholds using false-positive data.
5. Publish onboarding, test-authoring guides, and support runbook.

## 9. Definition of done for the MVP

- A user can run a saved suite against a URL at desktop and mobile viewports.
- A failed functional step includes a reproducible trace, screenshot, logs, and exact step.
- Automated accessibility findings include rule, impact, WCAG mapping, selector, and evidence.
- Screenshot baseline failures show baseline/current/diff views and respect configured masks.
- A run produces machine-readable output and a dependable CI pass/fail outcome.
- The product handles inaccessible/missing Figma and source connectors gracefully; tests still run with browser evidence.

## 10. Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Flaky visual diffs | Pin browser/fonts, mask dynamic content, wait for deterministic ready state, retain artifacts. |
| False confidence from automated a11y | Clearly label automated coverage; include manual-review checklist and keyboard evidence. |
| Figma mismatch due to frame scale or stale design | Store node ID, export dimensions, and revision; show reference provenance. |
| Sensitive data in screenshots/logs | Redact configured selectors/headers, encrypt artifacts, limit retention and access. |
| Source links are inaccurate | Attach confidence and fall back to selector/component information. |

## 11. Decisions needed before implementation

1. Which targets must be supported first: deployed URLs, localhost, Storybook, or a component harness?
2. Should the first release run locally, in CI, or as a hosted service?
3. Which browsers and WCAG conformance target (normally WCAG 2.2 AA) are required?
4. What authentication/session mechanism is permitted for test environments?
5. Which Figma MCP operations are available: frame export, node inspection, file metadata, and/or comments?

