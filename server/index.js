require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : null,
      lastName: lastName ? String(lastName).trim() : null,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({ ok: true, username: name, firstName: user.firstName || null, lastName: user.lastName || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube Channel Download ──────────────────────────────────────────────────

app.post('/api/youtube/channel', async (req, res) => {
  try {
    const { channelUrl, maxVideos = 10 } = req.body;
    const apiKey = process.env.REACT_APP_YOUTUBE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'YouTube API key not configured' });
    if (!channelUrl) return res.status(400).json({ error: 'channelUrl required' });

    // Resolve channel ID from URL
    let channelId = null;
    let channelHandle = null;

    // Extract handle or channel ID from URL
    const handleMatch = channelUrl.match(/@([\w.-]+)/);
    const channelIdMatch = channelUrl.match(/channel\/(UC[\w-]+)/);
    const userMatch = channelUrl.match(/\/user\/([\w.-]+)/);

    if (handleMatch) {
      channelHandle = handleMatch[1];
    } else if (channelIdMatch) {
      channelId = channelIdMatch[1];
    }

    // Search for channel by handle or username
    if (!channelId) {
      const searchQuery = channelHandle || (userMatch ? userMatch[1] : channelUrl);
      const searchResp = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          q: searchQuery,
          type: 'channel',
          maxResults: 1,
          key: apiKey,
        },
      });
      channelId = searchResp.data.items?.[0]?.id?.channelId;
      if (!channelId) return res.status(404).json({ error: 'Channel not found' });
    }

    // Get channel uploads playlist
    const channelResp = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'contentDetails,snippet',
        id: channelId,
        key: apiKey,
      },
    });
    const channel = channelResp.data.items?.[0];
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

    // Get videos from uploads playlist
    const limit = Math.min(parseInt(maxVideos) || 10, 100);
    let videoIds = [];
    let pageToken = null;

    while (videoIds.length < limit) {
      const params = {
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: Math.min(50, limit - videoIds.length),
        key: apiKey,
      };
      if (pageToken) params.pageToken = pageToken;

      const playlistResp = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', { params });
      const items = playlistResp.data.items || [];
      videoIds.push(...items.map((item) => item.snippet.resourceId.videoId));
      pageToken = playlistResp.data.nextPageToken;
      if (!pageToken) break;
    }
    videoIds = videoIds.slice(0, limit);

    // Get detailed video stats in batches of 50
    const videos = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const videoResp = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'snippet,statistics,contentDetails',
          id: batch.join(','),
          key: apiKey,
        },
      });
      for (const v of videoResp.data.items || []) {
        // Parse duration (ISO 8601 PT#M#S)
        const dur = v.contentDetails.duration || '';
        const durMatch = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        const hours = parseInt(durMatch?.[1] || 0);
        const minutes = parseInt(durMatch?.[2] || 0);
        const seconds = parseInt(durMatch?.[3] || 0);
        const durationSecs = hours * 3600 + minutes * 60 + seconds;

        // Try to get transcript (not blocking — skip if unavailable)
        let transcript = null;
        try {
          const transcriptResp = await axios.get(
            `https://www.youtube.com/watch?v=${v.id}`,
            { timeout: 5000, headers: { 'Accept-Language': 'en-US' } }
          );
          // Extract timedtext URL from page source
          const timedtextMatch = transcriptResp.data.match(/"captionTracks":\[.*?"baseUrl":"([^"]+)"/);
          if (timedtextMatch) {
            const captionUrl = timedtextMatch[1].replace(/\\u0026/g, '&');
            const captionResp = await axios.get(captionUrl, { timeout: 5000 });
            // Parse XML transcript
            const textMatches = captionResp.data.match(/<text[^>]*>([^<]*)<\/text>/g);
            if (textMatches) {
              transcript = textMatches
                .map((t) => t.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim())
                .filter(Boolean)
                .join(' ')
                .slice(0, 2000);
            }
          }
        } catch {
          // Transcript unavailable, continue without it
        }

        videos.push({
          title: v.snippet.title,
          description: (v.snippet.description || '').slice(0, 500),
          duration: durationSecs,
          release_date: v.snippet.publishedAt,
          view_count: parseInt(v.statistics.viewCount || 0),
          like_count: parseInt(v.statistics.likeCount || 0),
          comment_count: parseInt(v.statistics.commentCount || 0),
          video_url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail_url: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
          transcript,
        });
      }
    }

    res.json({ channelName: channel.snippet.title, videos });
  } catch (err) {
    console.error('[YouTube API error]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
