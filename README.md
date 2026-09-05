# SatQueryAI
Desktop chat UI for SatQueryAI — a satellite-data chat assistant. Built with

React + Vite + TypeScript. Glassy violet-themed layout with dark and light modes.

## Quick start

```powershell
npm install
npm run dev
```

Open http://localhost:5173. Runs as a desktop-first app (min window width 1024px).

## Wiring in your RAG backend

All backend integration lives in **`src/api/chat.ts`**.

1. Run your RAG server (FastAPI, LangChain, LlamaIndex, ...) on
   `http://localhost:8000` (or change the `/api` proxy target in `vite.config.ts`).
2. Implement:

   ```
   POST /api/chat
   { "model": "satquery-rag", "messages": [{ "role": "user|assistant", "content": "..." }], "stream": true }
   ```

   Response may be any of:
   - SSE: `data: {"token": "..."}` lines ending with `data: [DONE]`
   - Plain-text streaming body
   - JSON: `{ "answer": "..." }`

3. Copy `.env.example` to `.env` and keep `VITE_USE_MOCK=false` so the UI talks
   to your backend instead of the built-in mock.

While `VITE_USE_MOCK` is not `false`, a simulated streaming reply is generated
locally so you can develop the UI with no backend running.

## Features

- **Map area picker** — the composer is a plain text field (type your question
  directly); tap the map pin button to pop the map and attach imagery. Live
  Esri World Imagery tiles on canvas, pan / wheel-zoom / keyboard, place
  search via the Esri geocoder, and a 512 px capture footprint you confirm
  with “Use this area”. **The main map follows the chosen timeline** — picking a
  dated release repaints the canvas from that Wayback release. Imagers:
  **Optical** (current mosaic or any dated Wayback release), **SAR**
  (simulated C-band VV — the canvas renders the scene as a desaturated radar
  frame), or **Bi-Temporal Pair** (any two dates from the full Wayback archive
  — ~196 releases, 2014 → today; `*` marks the ones with new imagery over the
  footprint). For a pair, T1/T2 pills over the map flip which era the canvas
  shows. The selection attaches to your question as a chip and as
  `aoi: { lon, lat, zoom }` + `imagery: { mode, t1?, t2? }` on the message
  sent to the RAG backend (see `src/components/AreaPicker.tsx`,
  `src/lib/basemap.ts`).
- **Dark / light theme** — toggle in the sidebar footer; follows your OS
  preference by default, the choice is persisted (`localStorage`), and a
  pre-paint script in `index.html` prevents a theme flash on load. Each mode is
  a full palette (deep-space violet ⚖ lavender daylight) with ambient aurora
  light, glass surfaces and an accent-2 teal for map context. The map canvas,
  its overlay chips and code blocks stay dark in both modes.
- Sidebar with conversation history (persisted to `localStorage`), new / open / delete
- Streaming token-by-token responses with typing indicator and "stop" button
- Markdown + GFM tables in AI answers (`react-markdown`)
- Enter to send, Shift+Enter for newline, auto-growing input
- Jump-to-latest scroll affordance
- Suggested starting queries on the empty state

The map picker and place search call Esri's keyless endpoints directly from the
browser (CORS-enabled); no API key or server needed.

## Project layout

```
src/
  api/chat.ts         ← RAG integration point (endpoint, streaming, config)
  api/mock.ts         ← mock streaming backend
  hooks/useChat.ts    ← conversations, streaming state, persistence
  hooks/useTheme.ts   ← light/dark theme state + persistence
  lib/basemap.ts      ← ESri tile math, image capture, Wayback, place search
  components/         ← Sidebar, ChatPanel, MessageList, Message, ChatInput, Welcome, AreaPicker (map)
  data/suggestions.ts ← starter prompt chips
  data/imageryModes.ts ← Optical / SAR / Bi-Temporal mode metadata
```
