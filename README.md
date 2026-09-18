# Wording Inspector

Local tool for comparing visible page wording with the text in a Figma frame. The report highlights page words that differ and keeps links to the current render and Figma reference visible for every run.

## Run locally

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`. Enter a page URL, a Figma frame URL containing `node-id`, and a Figma personal access token (or set `FIGMA_TOKEN` before starting the server). The browser viewport automatically uses the selected Figma frame's width and height. The token stays in server memory and is not written to the report. Screenshots and the JSON report are saved under `artifacts/`.

If a notification covers the page, enter its close-button CSS selector. The runner attempts to click it before capturing the current render.

The wording test compares word counts from Figma text nodes with visible page words. It marks extra page words on the screenshot and lists words from Figma that are absent from the page. The Figma reference button opens the exported frame when available, or the original Figma URL if export fails. The current render button is available once the page screenshot is captured.
