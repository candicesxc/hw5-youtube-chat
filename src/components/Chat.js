import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithCsvTools, chatWithJsonTools, CODE_KEYWORDS, generateImageFromPrompt } from '../services/gemini';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import { executeJsonTool } from '../services/jsonTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import MetricLineChart from './MetricLineChart';
import VideoCard from './VideoCard';
import YouTubeDownload from './YouTubeDownload';
import './Chat.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Encode a string to base64 safely (handles unicode/emoji in tweet text etc.)
const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;

  // Short human-readable preview (header + first 5 rows) for context
  const preview = lines.slice(0, 6).join('\n');

  // Full CSV as base64 — avoids ALL string-escaping issues in Python code execution
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;

  return { headers, rowCount, preview, base64, truncated };
};

// Extract plain text from a message (for history only — never returns base64)
const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer (code execution responses) ───────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot"
              className="part-image"
            />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Generated image with lightbox ─────────────────────────────────────────────

function GeneratedImage({ data, mimeType, prompt }) {
  const [enlarged, setEnlarged] = useState(false);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `data:${mimeType};base64,${data}`;
    link.download = 'generated_image.png';
    link.click();
  };

  return (
    <>
      <div className="generated-image-wrap">
        <img
          src={`data:${mimeType};base64,${data}`}
          alt={prompt}
          className="generated-image"
          onClick={() => setEnlarged(true)}
          style={{ cursor: 'zoom-in' }}
        />
        <div className="generated-image-actions">
          <button className="chart-action-btn" onClick={() => setEnlarged(true)} title="Enlarge">⛶</button>
          <button className="chart-action-btn" onClick={handleDownload} title="Download">⬇</button>
        </div>
      </div>
      {enlarged && (
        <div className="chart-lightbox" onClick={() => setEnlarged(false)}>
          <div className="chart-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="chart-lightbox-header">
              <span>{prompt}</span>
              <button onClick={() => setEnlarged(false)}>✕</button>
            </div>
            <img
              src={`data:${mimeType};base64,${data}`}
              alt={prompt}
              style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 }}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ username, firstName, lastName, onLogout }) {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'youtube'
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);     // pending attachment chip
  const [sessionCsvRows, setSessionCsvRows] = useState(null);    // parsed rows for JS tools
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null); // headers for tool routing
  const [csvDataSummary, setCsvDataSummary] = useState(null);    // auto-computed column stats summary
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);   // key-columns CSV string sent directly to Gemini

  // JSON (YouTube) data state
  const [sessionJsonRows, setSessionJsonRows] = useState(null);  // parsed JSON video rows
  const [jsonContext, setJsonContext] = useState(null);           // chip for JSON attachment
  const [jsonFileName, setJsonFileName] = useState(null);

  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  // Set to true immediately before setActiveSessionId() is called during a send
  // so the messages useEffect knows to skip the reload (streaming is in progress).
  const justCreatedSessionRef = useRef(false);

  // Full name for context
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || username;

  // On login: load sessions from DB; 'new' means an unsaved pending chat
  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new'); // always start with a fresh empty chat on login
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    // If a session was just created during an active send, messages are already
    // in state and streaming is in progress — don't wipe them.
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setSessionJsonRows(null);
    setJsonContext(null);
    setJsonFileName(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setSessionJsonRows(null);
    setJsonContext(null);
    setJsonFileName(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const loadJsonFile = async (file) => {
    const text = await fileToText(file);
    try {
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : (parsed.videos || Object.values(parsed));
      if (!rows.length) throw new Error('JSON file appears to be empty');
      // Build a summary string
      const fields = rows.length ? Object.keys(rows[0]) : [];
      const summary = `${rows.length} items, fields: ${fields.join(', ')}`;
      setSessionJsonRows(rows);
      setJsonContext({ name: file.name, count: rows.length, fields });
      setJsonFileName(file.name);
      return summary;
    } catch (err) {
      console.error('[JSON parse error]', err);
      return null;
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      await loadJsonFile(jsonFiles[0]);
    }

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        // Parse rows, add computed engagement col, build summary + slim CSV
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      await loadJsonFile(jsonFiles[0]);
    }

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  // ── Stop generation ─────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext && !jsonContext) || streaming || !activeSessionId) return;

    // Lazily create the session in DB on the very first message
    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'lisa', title);
      sessionId = id;
      justCreatedSessionRef.current = true; // tell useEffect to skip the reload
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'lisa', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    // ── Routing intent ─────────────────────────────────────────────────────────
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text);
    const wantCode = CODE_KEYWORDS.test(text) && !sessionCsvRows && !sessionJsonRows;
    const capturedCsv = csvContext;

    const needsBase64 = !!capturedCsv && wantPythonOnly;

    // useJsonTools: when JSON is loaded and no Python keywords
    const useJsonTools = !!sessionJsonRows && !wantPythonOnly && !wantCode;
    // useTools: CSV loaded and no Python needed
    const useTools = !!sessionCsvRows && !wantPythonOnly && !wantCode && !capturedCsv && !useJsonTools;
    const useCodeExecution = wantPythonOnly || wantCode;

    // ── Build prompt ─────────────────────────────────────────────────────────
    const sessionSummary = csvDataSummary || '';
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    const csvPrefix = capturedCsv
      ? needsBase64
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

IMPORTANT — to load the full data in Python use this exact pattern:
\`\`\`python
import pandas as pd, io, base64
df = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))
\`\`\`

---

`
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

---

`
      : sessionSummary
      ? `[CSV columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`
      : '';

    // JSON context prefix
    const jsonPrefix = sessionJsonRows
      ? `[JSON Data: "${jsonFileName}" | ${sessionJsonRows.length} videos | Fields: ${jsonContext?.fields?.join(', ') || ''}]\n\n`
      : '';

    // Include user's full name in context prefix
    const namePrefix = fullName && fullName !== username ? `[User: ${fullName}]\n` : '';

    const userContent = text || (images.length ? '(Image)' : jsonContext ? '(JSON attached)' : '(CSV attached)');
    const promptForGemini = namePrefix + jsonPrefix + csvPrefix + (text || (images.length ? 'What do you see in this image?' : jsonContext ? 'Please analyze this JSON data.' : 'Please analyze this CSV data.'));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      csvName: capturedCsv?.name || null,
      jsonName: jsonContext?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setCsvContext(null);
    setStreaming(true);

    // Store display text only — base64 is never persisted
    await saveMessage(sessionId, 'user', userContent, capturedImages.length ? capturedImages : null);

    const imageParts = capturedImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));

    // History: plain display text only — session summary handles CSV context on every message
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];
    let videoCards = [];
    let generatedImages = [];

    try {
      if (useJsonTools) {
        // ── JSON function-calling path ─────────────────────────────────────────
        console.log('[Chat] useJsonTools=true | rows:', sessionJsonRows.length);
        const anchorImage = capturedImages.length > 0 ? capturedImages[0] : null;
        const jsonSummary = jsonContext ? `${jsonContext.count} videos, fields: ${jsonContext.fields?.join(', ')}` : '';

        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls,
                videoCards: returnedCards, generatedImages: returnedImages } = await chatWithJsonTools(
          history,
          promptForGemini,
          { summary: jsonSummary },
          (toolName, args) => executeJsonTool(toolName, args, sessionJsonRows, anchorImage, generateImageFromPrompt)
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        videoCards = returnedCards || [];
        generatedImages = returnedImages || [];

        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                  videoCards: videoCards.length ? videoCards : undefined,
                  generatedImages: generatedImages.length ? generatedImages : undefined,
                }
              : msg
          )
        );
      } else if (useTools) {
        // ── CSV Function-calling path ──────────────────────────────────────────
        console.log('[Chat] useTools=true | rows:', sessionCsvRows.length, '| headers:', sessionCsvHeaders);
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithCsvTools(
          history,
          promptForGemini,
          sessionCsvHeaders,
          (toolName, args) => executeTool(toolName, args, sessionCsvRows)
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else {
        // ── Streaming path: code execution or search ─────────────────────────
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: structuredParts } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const errText = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg))
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    // Save plain text + any tool charts to DB
    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    await saveMessage(
      sessionId,
      'model',
      savedContent,
      null,
      toolCharts.length ? toolCharts : null,
      toolCalls.length ? toolCalls : null
    );

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s))
    );

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>
            + New Chat
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{fullName}</span>
          <button onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────── */}
      <div className="chat-main">
        {/* Tab bar */}
        <div className="tab-bar">
          <button
            className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={`tab-btn${activeTab === 'youtube' ? ' active' : ''}`}
            onClick={() => setActiveTab('youtube')}
          >
            YouTube Channel Download
          </button>
        </div>

        {activeTab === 'youtube' ? (
          <div className="tab-content">
            <YouTubeDownload />
          </div>
        ) : (
          <>
            <header className="chat-header">
              <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
            </header>

            <div
              className={`chat-messages${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {messages.map((m) => (
                <div key={m.id} className={`chat-msg ${m.role}`}>
                  <div className="chat-msg-meta">
                    <span className="chat-msg-role">{m.role === 'user' ? (firstName || username) : 'Lisa'}</span>
                    <span className="chat-msg-time">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* CSV badge on user messages */}
                  {m.csvName && (
                    <div className="msg-csv-badge">
                      📄 {m.csvName}
                    </div>
                  )}

                  {/* JSON badge on user messages */}
                  {m.jsonName && (
                    <div className="msg-csv-badge">
                      📊 {m.jsonName}
                    </div>
                  )}

                  {/* Image attachments */}
                  {m.images?.length > 0 && (
                    <div className="chat-msg-images">
                      {m.images.map((img, i) => (
                        <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                      ))}
                    </div>
                  )}

                  {/* Message body */}
                  <div className="chat-msg-content">
                    {m.role === 'model' ? (
                      m.parts ? (
                        <StructuredParts parts={m.parts} />
                      ) : m.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      ) : (
                        <span className="thinking-dots">
                          <span /><span /><span />
                        </span>
                      )
                    ) : (
                      m.content
                    )}
                  </div>

                  {/* Tool calls log */}
                  {m.toolCalls?.length > 0 && (
                    <details className="tool-calls-details">
                      <summary className="tool-calls-summary">
                        🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                      </summary>
                      <div className="tool-calls-list">
                        {m.toolCalls.map((tc, i) => (
                          <div key={i} className="tool-call-item">
                            <span className="tool-call-name">{tc.name}</span>
                            <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                            {tc.result && !tc.result._chartType && !tc.result._videoCard && !tc.result._generatedImage && (
                              <span className="tool-call-result">
                                → {JSON.stringify(tc.result).slice(0, 200)}
                                {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                              </span>
                            )}
                            {(tc.result?._chartType || tc.result?._videoCard || tc.result?._generatedImage) && (
                              <span className="tool-call-result">→ rendered</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Engagement charts from CSV tool calls */}
                  {m.charts?.map((chart, ci) =>
                    chart._chartType === 'engagement' ? (
                      <EngagementChart
                        key={ci}
                        data={chart.data}
                        metricColumn={chart.metricColumn}
                      />
                    ) : chart._chartType === 'line_chart' ? (
                      <MetricLineChart
                        key={ci}
                        data={chart.data}
                        field={chart.field}
                      />
                    ) : null
                  )}

                  {/* Video cards */}
                  {m.videoCards?.map((vc, vi) => (
                    <VideoCard
                      key={vi}
                      title={vc.title}
                      thumbnailUrl={vc.thumbnailUrl}
                      videoUrl={vc.videoUrl}
                    />
                  ))}

                  {/* Generated images */}
                  {m.generatedImages?.map((gi, gi_i) => (
                    <GeneratedImage
                      key={gi_i}
                      data={gi.data}
                      mimeType={gi.mimeType}
                      prompt={gi.prompt}
                    />
                  ))}

                  {/* Search sources */}
                  {m.grounding?.groundingChunks?.length > 0 && (
                    <div className="chat-msg-sources">
                      <span className="sources-label">Sources</span>
                      <div className="sources-list">
                        {m.grounding.groundingChunks.map((chunk, i) =>
                          chunk.web ? (
                            <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                              {chunk.web.title || chunk.web.uri}
                            </a>
                          ) : null
                        )}
                      </div>
                      {m.grounding.webSearchQueries?.length > 0 && (
                        <div className="sources-queries">
                          Searched: {m.grounding.webSearchQueries.join(' · ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {dragOver && <div className="chat-drop-overlay">Drop CSV, JSON, or images here</div>}

            {/* ── Input area ── */}
            <div className="chat-input-area">
              {/* CSV chip */}
              {csvContext && (
                <div className="csv-chip">
                  <span className="csv-chip-icon">📄</span>
                  <span className="csv-chip-name">{csvContext.name}</span>
                  <span className="csv-chip-meta">
                    {csvContext.rowCount} rows · {csvContext.headers.length} cols
                  </span>
                  <button className="csv-chip-remove" onClick={() => setCsvContext(null)} aria-label="Remove CSV">×</button>
                </div>
              )}

              {/* JSON chip */}
              {jsonContext && (
                <div className="csv-chip json-chip">
                  <span className="csv-chip-icon">📊</span>
                  <span className="csv-chip-name">{jsonContext.name}</span>
                  <span className="csv-chip-meta">
                    {jsonContext.count} items
                  </span>
                  <button className="csv-chip-remove" onClick={() => { setJsonContext(null); setSessionJsonRows(null); setJsonFileName(null); }} aria-label="Remove JSON">×</button>
                </div>
              )}

              {/* Image previews */}
              {images.length > 0 && (
                <div className="chat-image-previews">
                  {images.map((img, i) => (
                    <div key={i} className="chat-img-preview">
                      <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                      <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Hidden file picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.csv,text/csv,.json,application/json"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />

              <div className="chat-input-row">
                <button
                  type="button"
                  className="attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming}
                  title="Attach image, CSV, or JSON"
                >
                  📎
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Ask a question, request analysis, or write & run code…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  onPaste={handlePaste}
                  disabled={streaming}
                />
                {streaming ? (
                  <button onClick={handleStop} className="stop-btn">
                    ■ Stop
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && !images.length && !csvContext && !jsonContext}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
