# Design QA Inspector

A local Figma-to-website validation tool. It compares structured Figma data with the rendered DOM and computed CSS at the same viewport. Screenshot overlays and difference maps are supporting evidence; they do not create issues or determine severity.

## Start the tool

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000` and provide:

- A website URL.
- A Figma frame URL containing `node-id`.
- A Figma personal access token, unless `FIGMA_TOKEN` is set on the server.
- One analysis mode.
- A viewport and tolerance profile.

**Include header and footer** is enabled by default in every mode. Clear it to omit `header`, `footer`, `#mc-header`, `#mc-footer`, `.mc-header`, and `.mc-footer` from analysis without removing those elements from the rendered page.

## Analysis modes

Exactly one mode runs per request:

- **Full Design QA** analyzes hierarchy, missing and extra elements, relative geometry, padding, gaps, alignment, typography, colors, borders, radii, opacity, shadow presence, content, and component coverage.
- **Wording only** keeps the existing phrase and section comparison report. Only changed, missing, and extra wording is highlighted.
- **Style/spacing only** keeps the focused semantic auto-layout and token report. It compares Figma padding, item spacing, alignment, typography, and text color with computed CSS.

Submitting an array or combined test type returns `400` with `Select exactly one test type`.

API example:

```json
{
  "testType": "design-qa",
  "url": "http://localhost:5173/checkout",
  "figmaUrl": "https://www.figma.com/design/FILE/Name?node-id=1-2",
  "includeHeaderFooter": true,
  "viewport": { "width": 1440, "height": 900 },
  "thresholds": { "spacingPx": 2, "colorDistance": 18 }
}
```

## Report

The Full Design QA report provides:

- Overall and category scores with the scoring formula and weights.
- Side-by-side, adjustable overlay, and filtered difference-map views.
- Issue filters by category and severity.
- Exact expected, actual, and delta values.
- Match confidence and a `needs review` state below the confidence threshold.
- Separate measured facts, likely causes, and suggested investigation steps.
- Issue-only highlights on both the website capture and normalized Figma image.

Artifacts and `report.json` are written under `artifacts/<run-id>/`. Figma tokens remain in server memory and are not written to the report.

See [Design QA architecture](docs/design-qa-architecture.md) for the data model, matching algorithm, tolerances, severity rules, scoring, and known limitations.

## Spacing tokens

The focused Style/spacing mode discovers CSS custom properties such as `--spacing-lg`, `--space-xl`, and `--gap-2xl`. It uses Figma variable names when the Variables API is available and falls back to resolving Figma auto-layout values against the website token scale. Reports prefer token names with pixel evidence, for example `expected lg (20px; spacing/lg), actual xl (40px; --spacing-xl)`.

Container matching uses text only as an anchor; wording differences are never reported in this mode. Geometry, layout direction, hierarchy depth, and content count disambiguate nested wrappers that contain the same text. Effective visual insets and child gaps suppress false issues when equivalent spacing is owned by different Figma and DOM wrapper layers. Alignment is reported only when free space exists for that alignment property to change the rendered result, and repeated component issues are grouped by occurrence count.

## Verify changes

```powershell
npm test
```

The suite contains deterministic ground-truth checks plus browser integration tests for mode selection, header/footer behavior, issue highlighting, matching confidence, scoring, and all three visual views.
