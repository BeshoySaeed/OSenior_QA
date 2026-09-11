# Web Quality Inspector

Working local MVP for a tool that tests web pages and components against visual designs, functional expectations, and accessibility requirements.

Start with [the feature plan](docs/feature-plan.md), then use [the requirements](docs/requirements.md) as the build and acceptance contract.

## Run locally

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`. Enter a page URL, optional functional-flow JSON, and run the inspection. Browser screenshots and the JSON report are saved under `artifacts/`.

## Figma pixel comparison

Set a Figma personal access token before starting the server, or paste it into the dashboard's per-run password field. The per-run value is used only in memory by that run and is never written to run metadata, reports, screenshots, or artifacts. Do not commit tokens.


Paste a Figma **frame** URL containing `node-id` into the dashboard. The run exports the frame and saves the reference plus pixel diff under `artifacts/`. The selected browser viewport must exactly equal the exported Figma frame dimensions; otherwise the run reports a dimension mismatch instead of scaling either image. Set **Allowed visual difference** to `0` for strict matching. For meaningful strict results, keep browser, fonts, color scheme, and dynamic content fixed.

The server process must be permitted to make outbound HTTPS requests to both the target site and `api.figma.com`; blocked navigation/export is reported as a high-severity finding rather than a passing run.

## Notifications and clearer visual results

If a cookie banner, pre-notification, or modal sometimes covers the page, enter its close-button CSS selector in **Dismiss notification selector**. The runner clicks it before taking the screenshot; absence of the notification does not fail a run.

Figma comparisons now include a **Page with visual differences marked** artifact embedded in the report. Red borders group nearby pixel differences into areas to review; the report also lists their coordinates. The image comparison can identify visual differences, but it cannot reliably prove whether a region is specifically wording, spacing, styling, or missing content without semantic mapping to Figma nodes and the page DOM.

## Select specific checks

Choose one or more checks in **Tests to run**:

- **Wording** reads text nodes from the selected Figma frame and visible words from the page, then outlines only page words that are not present in the design text. It needs Figma access.
- **Style & spacing** performs the Figma pixel comparison and outlines grouped visual areas. It needs a Figma frame URL.
- **Functionality** requires functional-flow JSON and runs only those interactions/assertions.
- **Accessibility** runs the automated WCAG checks.
