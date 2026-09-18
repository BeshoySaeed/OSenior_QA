# Web Quality Inspector

Local tool for comparing page wording or style/spacing with a Figma frame. Each run executes exactly one test type and keeps links to the current render and Figma reference.

## Run locally

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`. Choose **Wording** or **Style/Spacing** from the single test-type select, then enter a page URL, a Figma frame URL containing `node-id`, and a Figma personal access token (or set `FIGMA_TOKEN` before starting the server). **Include header and footer** is checked by default for both modes; uncheck it to omit those regions from validation while keeping the page layout intact. The browser viewport automatically uses the selected Figma frame's width and height. The token stays in server memory and is not written to the report. Screenshots and the JSON report are saved under `artifacts/`.

API callers can POST to `/api/runs` with one `testType` value (`"wording"` or `"style-spacing"`) and one boolean `includeHeaderFooter` value. An array or combined test type is rejected. Omitting `testType` keeps existing API callers on wording mode; omitting `includeHeaderFooter` includes those regions.

If a notification covers the page, enter its close-button CSS selector. The runner attempts to click it before capturing the current render.

The wording test compares text phrases within page sections. Shared headings divide the page into sections; identical phrases are matched even if their order changes, and similar remaining phrases are paired as edits. The report shows Figma and website phrases side by side, including website-only and Figma-only text. Red borders on the website screenshot mark changed and website-only phrases. If a Figma export is available, a second annotated image marks Figma phrases missing from the website. Matching phrases are never marked. The Figma reference button opens the exported frame when available, or the original Figma URL if export fails. The current render button is available once the page screenshot is captured.

The style/spacing test uses the selected Figma frame as its baseline. It matches visible text anchors by exact wording, then compares their horizontal and vertical positions, vertical gaps between stacked anchors, font size, line height, font weight, and text color when Figma provides those values. Rendered positions and gaps reflect the effective margin/padding and alignment without requiring access to the site's CSS source. Tolerances are 4 px for position and gap, 1 px for font size, 2 px for line height, 50 for font weight, and 8 per color channel. Unmatched wording is outside this mode's scope. The report uses the same `comparisons`, `findings`, and screenshot-artifact structure as wording mode; only failing elements are outlined.

Run the focused comparison and browser checks with `npm test`.
