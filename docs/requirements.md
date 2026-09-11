# Requirements: Web Quality Inspector

## 1. Goals and success measures

The tool shall help teams detect high-confidence regressions before release by unifying visual, functional, and accessibility evidence.

| Metric | Initial target |
| --- | --- |
| Successful-run reliability on stable fixtures | at least 98% over 100 runs |
| Functional failure evidence completeness | 100% of failures have step, screenshot, and trace/log artifact |
| Accessibility finding traceability | 100% have rule, selector, severity, and WCAG mapping when applicable |
| Visual finding explainability | 100% have baseline, current image, and diff or a stated comparison error |
| Median single-page run time | under 3 minutes for one viewport on the reference environment |

## 2. Functional requirements

### FR-1: target configuration

1. The system shall accept HTTP(S) URLs, including local test URLs when the runner can reach them.
2. The system shall support saved targets and configurable viewport profiles.
3. The system shall allow a readiness condition: selector visible, custom JS predicate, fixed wait (discouraged), or network idle.
4. The system shall record target URL, resolved URL, run environment, browser version, viewport, locale, color scheme, and time in every run.

### FR-2: visual validation

1. The system shall capture full-page and viewport screenshots.
2. The user shall be able to compare against an approved screenshot baseline and, when connected, a selected Figma frame.
3. The system shall show baseline/reference, current render, and a diff overlay.
4. The system shall support per-viewport thresholds and selector/rectangle masks for dynamic regions.
5. The system shall report comparison settings, image dimensions, and a normalized difference score.
6. The system shall not silently approve a changed baseline; approval requires explicit authorized user action and audit history.

### FR-3: Figma context

1. When Figma MCP is available and authorized, the system shall let the user select a file/frame/node reference.
2. The system shall save the canonical Figma URL, node ID, frame dimensions, export resolution, and observed revision/version where available.
3. If Figma access fails, the system shall retain the browser test result and clearly mark design comparison as unavailable.
4. The system shall not modify Figma files or comments in v1.

### FR-4: functional flows

1. The system shall support these declarative steps: navigate, click, type, select, check/uncheck, press key, hover, wait, scroll, upload test file, and screenshot.
2. The system shall support assertions for URL, visible/hidden, text, attribute, enabled/disabled, count, network response, console error absence, and screenshot checkpoint.
3. Each step shall have a timeout and a human-readable label.
4. On failure the system shall capture the failed step, selector/locator, screenshot, DOM snapshot, console output, network failures, and browser trace.
5. The tool shall support test data variables supplied at run time without exposing their value in reports.

Example flow:

```yaml
name: checkout validation
steps:
  - action: navigate
    url: /checkout
  - action: click
    locator: { role: button, name: Continue }
  - expect: visible
    locator: { role: alert }
  - expect: text
    locator: { role: alert }
    value: Enter an email address
```

### FR-5: accessibility validation

1. The system shall run an automated accessibility engine against each configured page state.
2. Findings shall include rule ID, help text, impact, selector/target, HTML/ARIA evidence, and WCAG criterion where supplied by the rule engine.
3. The system shall check keyboard reachability, focus order, visible focus, and focus trapping/return for configured dialogs.
4. The system shall check basic document semantics: title, language, landmarks, heading order, form labels, image alternatives, and accessible names.
5. The report shall label checks as automated, assisted, or manual-review-required; it shall not claim full WCAG conformance from automation.
6. The default policy shall be WCAG 2.2 AA, configurable per suite.

### FR-6: source correlation

1. With authorized source access, the system shall attempt to map a finding's selector, component name, or source map location to a file and line.
2. Every source link shall display a confidence level and remain optional evidence, not a pass/fail dependency.
3. The system shall never transmit source code to a third-party analysis service without an explicit configured integration and user authorization.

### FR-7: reporting and triage

1. The system shall create an immutable report for each completed run.
2. Findings shall have category, severity, title, fingerprint, status, affected URL/viewport, and evidence.
3. The system shall group repeat occurrences of the same root issue while retaining individual occurrence evidence.
4. Users shall filter and export reports by category, severity, status, viewport, and WCAG criterion.
5. Exports shall include JSON; JUnit and SARIF should be included for CI/security-quality workflows.
6. Suppressions shall require a reason, owner, creation date, and expiry date.

### FR-8: CI and API

1. A command-line/API trigger shall start a suite and return a run identifier.
2. The caller shall be able to poll or receive a callback for completion.
3. The CI result shall fail according to configurable severity/category thresholds.
4. The system shall expose artifact URLs and a concise summary suitable for pull-request checks.

## 3. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Browser runs must use pinned browser and font versions in a given execution environment. |
| NFR-2 | Test jobs must be isolated by browser context; cookies, storage, and downloads may not leak between tenants/runs. |
| NFR-3 | Artifacts must be encrypted in transit and at rest; access must follow project permissions. |
| NFR-4 | Logs, screenshots, DOM snapshots, URLs, headers, and test variables must support configurable redaction. |
| NFR-5 | Run retries must be recorded and must not overwrite original artifacts. |
| NFR-6 | The system must retain raw evidence long enough to reproduce a reported result; retention must be configurable. |
| NFR-7 | The product UI must meet WCAG 2.2 AA for its core workflows. |
| NFR-8 | A failed connector, Figma fetch, source lookup, or one analysis adapter must not erase results from other adapters. |
| NFR-9 | All APIs must be authenticated, authorized per project, and auditable for baseline approvals and suppression changes. |
| NFR-10 | The runner must enforce navigation allowlists and block private-network targets unless explicitly enabled in a controlled environment. |

## 4. Severity policy

| Severity | Meaning | Default CI behavior |
| --- | --- | --- |
| Critical | Blocks a core journey, exposes sensitive data, or prevents access for many users | Fail |
| High | Major workflow, visual regression, or WCAG issue with broad impact | Fail |
| Medium | Meaningful defect with workaround or limited scope | Warn; configurable fail |
| Low | Polish issue or limited-impact improvement | Inform |
| Needs review | Tool found a possible issue requiring human judgment | Inform |

## 5. Acceptance scenarios

### Visual

- Given an approved desktop baseline, when a button shifts beyond the configured tolerance, then the run reports a visual finding with baseline/current/diff artifacts and the correct viewport.
- Given a masked live timestamp, when its value changes, then it does not cause a visual failure.
- Given unavailable Figma MCP access, when the browser baseline runs, then the report is complete except for a clearly marked Figma comparison error.

### Functional

- Given an invalid checkout form, when the flow submits it, then the report passes only if the expected error alert is visible and named correctly.
- Given a failed click because an overlay intercepts it, then the report includes the exact step, locator, screenshot, DOM snapshot, console/network details, and trace.

### Accessibility

- Given an unlabeled input, when the accessibility scan runs, then it creates a finding with rule, selector, severity, evidence, and WCAG mapping where available.
- Given a keyboard-only user opens a configured modal, when Tab cycles through controls, then focus must remain inside until close and return to the triggering control after close.
- Given an automated scan has no violations, then the report must still state that manual accessibility review remains necessary.

### Security and privacy

- Given a secret test variable, when it is used to log in, then its literal value never appears in screenshots where avoidable, logs, DOM snapshots, exports, or error messages.
- Given a target redirects to an unapproved host, when navigation occurs, then the runner blocks it and records a clear security finding.

## 6. Implementation checklist

1. Write the configuration, result, and report schemas; version them from day one.
2. Build a stable fixture application with seeded defects and expected result snapshots.
3. Implement a browser worker with deterministic runtime defaults and artifact collection.
4. Implement target configuration, queueing, run persistence, and artifact storage.
5. Add declarative functional flows and report evidence for every failed step.
6. Add automated accessibility analysis and keyboard/focus checks.
7. Add baseline management, image comparison, masks, and tolerance controls.
8. Add Figma MCP adapter with graceful degradation and provenance capture.
9. Add source adapter with opt-in permissions and confidence-scored links.
10. Build report UI, triage, exports, CI thresholding, and pull-request summary.
11. Threat-model SSRF, credentials, artifact leakage, malicious pages, and connector tokens.
12. Run end-to-end acceptance scenarios, accessibility test the tool itself, pilot, then tune thresholds before broad rollout.

