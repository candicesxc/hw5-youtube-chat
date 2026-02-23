# HW5 — YouTube Chat App

A YouTube channel analysis chatbot built on React + Express + MongoDB + Gemini AI. Drop in a JSON file of YouTube video data and ask questions, generate charts, play videos, and create images — all powered by Gemini function calling.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Recharts, react-markdown |
| Backend | Express 5 (port 3001) |
| AI | Google Gemini 2.0 Flash (function calling, streaming, code execution) |
| Database | MongoDB Atlas (`chatapp` database) |
| System prompt | `public/prompt_chat.txt` (hot-reloaded, no rebuild needed) |

## Setup

```bash
# Clone and install
git clone https://github.com/candicesxc/hw5-youtube-chat
cd hw5-youtube-chat
npm install

# Add environment variables (.env at project root)
REACT_APP_YOUTUBE_API_KEY=...
REACT_APP_GEMINI_API_KEY=...
REACT_APP_MONGODB_URI=...

# Run both frontend and backend
npm start
```

The app runs at `http://localhost:3000`, API at `http://localhost:3001`.

---

## Features

### 1. Chat Personalization

**Files changed:** `src/components/Auth.js`, `server/index.js`, `src/services/mongoApi.js`, `src/App.js`

- Added **First Name** and **Last Name** fields to the Create Account form
- Both fields are stored in MongoDB `users` collection alongside username/email
- After login, the user's full name is:
  - Shown in the sidebar footer (replacing just username)
  - Shown as the display name on chat messages
  - Injected into every AI prompt via `[User: Full Name]` prefix
- The system prompt (`public/prompt_chat.txt`) instructs the AI to greet users by first name

---

### 2. YouTube Channel Data Download Tab

**Files changed:** `src/components/YouTubeDownload.js`, `src/components/YouTubeDownload.css`, `server/index.js`, `src/services/mongoApi.js`

After login, a **YouTube Channel Download** tab appears next to the Chat tab.

**Features:**
- Text input for a YouTube channel URL (e.g. `https://www.youtube.com/@veritasium`)
- Number input for max videos (default 10, max 100)
- "Download Channel Data" button with animated progress bar
- Results displayed as a scrollable video list with thumbnails

**Backend endpoint:** `POST /api/youtube/channel`
- Resolves channel handle/URL → channel ID via YouTube Data API v3
- Fetches video IDs from the channel's uploads playlist
- Retrieves full metadata in batches of 50
- Attempts to extract transcript from YouTube caption XML
- Returns JSON with fields: `title`, `description`, `duration`, `release_date`, `view_count`, `like_count`, `comment_count`, `video_url`, `thumbnail_url`, `transcript`

**Veritasium sample data:** `public/veritasium.json` — 10 videos from `@veritasium`, fetched 2026-02-23.

---

### 3. JSON Chat Input

**Files changed:** `src/components/Chat.js`, `src/services/jsonTools.js`

Extends the existing drag-and-drop system to support JSON files.

- Drag a `.json` file into the chat window **or** click the 📎 button and select it
- The JSON is parsed and stored in frontend state (`sessionJsonRows`)
- A **green chip** appears in the input area showing filename + item count
- The JSON data is injected into every Gemini prompt as context
- All 4 JSON tools (below) operate on the loaded data
- Compatible with the `veritasium.json` format (array of video objects)

---

### 4. Tool: `generateImage`

**Files changed:** `src/services/jsonTools.js`, `src/services/gemini.js`, `src/components/Chat.js`

Gemini function-calling tool that generates images via AI.

- **Trigger:** User says "generate an image", "draw", "create a picture", etc.
- **Parameters:** `prompt` (text description)
- **Anchor image:** If the user has dragged in an image, it's passed as style guidance
- **Display:** Generated image appears inline in chat
  - Click to enlarge (lightbox with dark overlay)
  - Download button (⬇) appears on hover
- **API:** Tries `imagen-3.0-generate-002` first, falls back to `gemini-2.0-flash-exp-image-generation`
- **Documented** in `public/prompt_chat.txt`

---

### 5. Tool: `plot_metric_vs_time`

**Files changed:** `src/services/jsonTools.js`, `src/components/MetricLineChart.js`, `src/components/Chat.js`

Renders a Recharts line chart of a numeric field over video release dates.

- **Trigger:** User asks to "plot view_count over time", "chart likes by date", etc.
- **Parameters:** `field` (one of: `view_count`, `like_count`, `comment_count`, `duration`)
- **Chart features:**
  - Recharts `LineChart` with formatted Y-axis (K/M suffixes)
  - Click chart or ⛶ button to enlarge in lightbox
  - ⬇ button to download chart as PNG (or CSV fallback)
- **Documented** in `public/prompt_chat.txt`

---

### 6. Tool: `play_video`

**Files changed:** `src/services/jsonTools.js`, `src/components/VideoCard.js`, `src/components/Chat.js`

Displays a clickable video card that opens the YouTube video.

- **Trigger:** User says "play", "open", "watch", "show me" a video
- **Parameters:** `query` — accepts:
  - Ordinals: `first`, `second`, `third`, `last`
  - Attributes: `most viewed`, `most liked`, `most commented`, `longest`, `newest`, `oldest`
  - Title keywords: matched against video titles (case-insensitive)
- **Card shows:** thumbnail, title, "▶ Watch on YouTube" CTA
- Clicking opens the video in a new tab
- **Documented** in `public/prompt_chat.txt`

---

### 7. Tool: `compute_stats_json`

**Files changed:** `src/services/jsonTools.js`, `src/components/Chat.js`

Computes descriptive statistics for any numeric field in the loaded JSON data.

- **Trigger:** User asks for "stats", "average", "mean", "distribution", "summary" of a field
- **Parameters:** `field` (one of: `view_count`, `like_count`, `comment_count`, `duration`)
- **Returns:** `{ field, count, mean, median, std, min, max }`
- Follows the same pattern as the existing `compute_column_stats` CSV tool
- **Documented** in `public/prompt_chat.txt`

---

### 8. System Prompt (`public/prompt_chat.txt`)

Updated to document all new features:

- AI is now a **YouTube channel analysis assistant** (in addition to social media AI assistant)
- Documents the JSON data schema (all 10 fields with descriptions)
- Documents all 4 tools with exact names, descriptions, trigger conditions, and parameters
- Instructs AI to greet users by first name using the `[User: Name]` context prefix
- Preserves all existing CSV tool instructions

---

## File Structure

```
├── server/
│   └── index.js              Express API (users, sessions, messages, YouTube download)
├── src/
│   ├── App.js                Auth router with firstName/lastName state
│   ├── components/
│   │   ├── Auth.js           Login/signup form with First/Last Name fields
│   │   ├── Chat.js           Main chat interface (tabs, JSON/CSV drag-drop, all tools)
│   │   ├── EngagementChart.js Recharts bar chart (CSV engagement analysis)
│   │   ├── MetricLineChart.js Recharts line chart (JSON metric vs time) ← NEW
│   │   ├── VideoCard.js      Clickable YouTube video card ← NEW
│   │   └── YouTubeDownload.js YouTube channel download tab ← NEW
│   └── services/
│       ├── gemini.js         Gemini API (streaming, CSV tools, JSON tools, image gen)
│       ├── csvTools.js       CSV parsing, stats tools, engagement enrichment
│       ├── jsonTools.js      YouTube JSON tools (generateImage, plot, play, stats) ← NEW
│       └── mongoApi.js       Frontend API wrapper (updated for firstName/lastName, YouTube)
└── public/
    ├── prompt_chat.txt       System prompt (hot-reloaded)
    └── veritasium.json       Sample data: 10 Veritasium videos ← NEW
```

## Environment Variables

```
REACT_APP_YOUTUBE_API_KEY=   # YouTube Data API v3 key
REACT_APP_GEMINI_API_KEY=    # Google AI Studio key
REACT_APP_MONGODB_URI=       # MongoDB Atlas connection string
```
