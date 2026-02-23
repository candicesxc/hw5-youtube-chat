# HW5 — YouTube Chat App

A YouTube channel analysis chatbot built on React + Express + MongoDB + Gemini AI. Drop in a JSON file of YouTube video data and ask questions, generate charts, play videos, and create images — all powered by Gemini function calling.

## Live Demo

| Service | URL |
|---------|-----|
| Frontend | https://hw5-youtube-chat-frontend.onrender.com |
| Backend API | https://hw5-youtube-chat-backend.onrender.com |

> **Note:** Free Render instances spin down after inactivity — first load may take ~50 seconds.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Recharts, react-markdown |
| Backend | Express 5 (Node 22, port 3001) |
| AI | Google Gemini 2.5 Flash (function calling, streaming, code execution) |
| Image Generation | Gemini 2.5 Flash Image (`responseModalities: ['TEXT','IMAGE']`) |
| Database | MongoDB Atlas (`chatapp` database) |
| Deployment | Render (2 web services via `render.yaml` Blueprint) |
| System prompt | `public/prompt_chat.txt` (hot-reloaded, no rebuild needed) |

---

## Local Setup

```bash
# Clone and install
git clone https://github.com/candicesxc/hw5-youtube-chat
cd hw5-youtube-chat
npm install

# Create .env at project root (never committed to git)
REACT_APP_YOUTUBE_API_KEY=your_youtube_api_key
REACT_APP_GEMINI_API_KEY=your_gemini_api_key
REACT_APP_MONGODB_URI=your_mongodb_atlas_uri

# Run both frontend and backend
npm start
```

The app runs at `http://localhost:3000`, backend API at `http://localhost:3001`.

---

## Render Deployment

The repo includes a `render.yaml` Blueprint that defines two services:

- **`hw5-youtube-chat-frontend`** — Node web service: builds React app (`npm run build`), serves via `serve.js` (Express static server with SPA fallback)
- **`hw5-youtube-chat-backend`** — Node web service: runs `server/index.js`

**Required environment variables** (set in Render dashboard → Environment for each service):

| Variable | Used by |
|----------|---------|
| `REACT_APP_YOUTUBE_API_KEY` | Frontend (YouTube Data API v3) |
| `REACT_APP_GEMINI_API_KEY` | Frontend (Gemini AI) |
| `REACT_APP_MONGODB_URI` | Backend (MongoDB Atlas connection) |

**MongoDB Atlas:** Make sure Network Access allows `0.0.0.0/0` (all IPs) so Render's dynamic IPs can connect.

---

## Features

### 1. Chat Personalization

**Files:** `src/components/Auth.js`, `server/index.js`, `src/services/mongoApi.js`, `src/App.js`

- Added **First Name** and **Last Name** fields to the Create Account form
- Both fields stored in MongoDB `users` collection alongside username/email
- After login, the user's full name is:
  - Shown in the sidebar footer
  - Shown as the display name on chat messages
  - Injected into every AI prompt via `[User: Full Name]` prefix so the AI greets by first name

---

### 2. YouTube Channel Data Download Tab

**Files:** `src/components/YouTubeDownload.js`, `src/components/YouTubeDownload.css`, `server/index.js`, `src/services/mongoApi.js`

After login, a **YouTube** tab appears next to the Chat tab.

- Enter a YouTube channel URL (e.g. `https://www.youtube.com/@veritasium`)
- Choose max videos (1–100, default 10)
- Animated progress bar while fetching
- Results shown as scrollable video list with thumbnails and stats
- **⬇ Download JSON** button saves data as a `.json` file ready to drag into chat

**Backend endpoint:** `POST /api/youtube/channel`
- Resolves channel handle/URL → channel ID via YouTube Data API v3
- Fetches video IDs from the uploads playlist
- Retrieves full metadata in batches of 50
- Returns JSON with: `title`, `description`, `duration`, `release_date`, `view_count`, `like_count`, `comment_count`, `video_url`, `thumbnail_url`, `transcript`

**Sample data:** `public/veritasium.json` — 10 Veritasium videos fetched 2026-02-23.

---

### 3. JSON Chat Input

**Files:** `src/components/Chat.js`, `src/services/jsonTools.js`

- Drag a `.json` file into the chat window **or** click 📎 and select it
- JSON is parsed and stored in frontend state
- A **green chip** shows filename + item count in the input bar
- JSON data injected into every Gemini prompt as context
- Compatible with the `veritasium.json` format (array of video objects)

---

### 4. Tool: `generateImage`

**Files:** `src/services/jsonTools.js`, `src/services/gemini.js`, `src/components/Chat.js`

- **Trigger:** "generate an image", "draw", "create a picture", etc.
- **Model:** `gemini-2.5-flash-image` with `responseModalities: ['TEXT','IMAGE']`, falls back to `gemini-2.0-flash-preview-image-generation`
- **Anchor image:** If an image was dragged into chat, it's passed as style guidance
- **Display:** Generated image appears inline in chat with lightbox (click to enlarge) and ⬇ download button

---

### 5. Tool: `plot_metric_vs_time`

**Files:** `src/services/jsonTools.js`, `src/components/MetricLineChart.js`, `src/components/Chat.js`

- **Trigger:** "plot view_count over time", "chart likes by date", etc.
- **Parameters:** `field` — one of `view_count`, `like_count`, `comment_count`, `duration`
- Recharts `LineChart` sorted by `release_date`, Y-axis formatted with K/M suffixes
- Click ⛶ to enlarge in lightbox; ⬇ to download as PNG or CSV fallback

---

### 6. Tool: `play_video`

**Files:** `src/services/jsonTools.js`, `src/components/VideoCard.js`, `src/components/Chat.js`

- **Trigger:** "play", "open", "watch", "show me" a video
- **Query accepts:** ordinals (`first`, `last`), attributes (`most viewed`, `most liked`, `longest`, `newest`), or title keyword search
- Shows a clickable card with thumbnail + title + "▶ Watch on YouTube" — opens in new tab

---

### 7. Tool: `compute_stats_json`

**Files:** `src/services/jsonTools.js`, `src/components/Chat.js`

- **Trigger:** "stats", "average", "mean", "distribution", "summary" of a field
- **Parameters:** `field` — one of `view_count`, `like_count`, `comment_count`, `duration`
- Returns `{ field, count, mean, median, std, min, max }`

---

### 8. System Prompt (`public/prompt_chat.txt`)

- AI is a **YouTube channel analysis assistant** and social media teaching assistant
- Documents the full JSON video schema (all 10 fields)
- Documents all 4 tools with trigger conditions and parameters
- Instructs AI to greet users by first name using the `[User: Name]` prefix

---

## File Structure

```
├── server/
│   └── index.js                 Express API (users, sessions, messages, YouTube download)
├── src/
│   ├── App.js                   Auth router with firstName/lastName state
│   ├── components/
│   │   ├── Auth.js              Login/signup with First/Last Name fields
│   │   ├── Auth.css
│   │   ├── Chat.js              Main chat (tabs, drag-drop, all tools)
│   │   ├── Chat.css
│   │   ├── EngagementChart.js   Recharts bar chart (CSV engagement)
│   │   ├── MetricLineChart.js   Recharts line chart (JSON metric vs time)
│   │   ├── VideoCard.js         Clickable YouTube video card
│   │   ├── YouTubeDownload.js   YouTube channel download tab
│   │   └── YouTubeDownload.css
│   └── services/
│       ├── gemini.js            Gemini API (streaming, tools, image gen)
│       ├── csvTools.js          CSV tools (stats, engagement)
│       ├── jsonTools.js         JSON tools (generateImage, plot, play, stats)
│       └── mongoApi.js          Frontend API wrapper
├── public/
│   ├── prompt_chat.txt          System prompt (hot-reloaded)
│   └── veritasium.json          Sample: 10 Veritasium videos
├── serve.js                     Express static server for React build (Render frontend)
└── render.yaml                  Render Blueprint (2 web services)
```

## Environment Variables

```
REACT_APP_YOUTUBE_API_KEY=   # YouTube Data API v3 key (Google Cloud Console)
REACT_APP_GEMINI_API_KEY=    # Google AI Studio key
REACT_APP_MONGODB_URI=       # MongoDB Atlas connection string (also used as MONGODB_URI on server)
```
