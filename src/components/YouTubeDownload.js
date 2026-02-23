import { useState } from 'react';
import { downloadYouTubeChannel } from '../services/mongoApi';
import './YouTubeDownload.css';

export default function YouTubeDownload() {
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(10);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleDownload = async () => {
    if (!channelUrl.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setProgress('Fetching channel data...');
    try {
      const data = await downloadYouTubeChannel(channelUrl.trim(), maxVideos);
      setResult(data);
      setProgress(`Done! Fetched ${data.videos.length} videos.`);
    } catch (err) {
      setError(err.message || 'Failed to fetch channel data');
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.videos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.channelName || 'channel'}_videos.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="yt-download">
      <h2 className="yt-title">YouTube Channel Download</h2>
      <p className="yt-subtitle">
        Download video metadata (title, description, stats, transcript) for a YouTube channel.
      </p>

      <div className="yt-form">
        <label className="yt-label">Channel URL</label>
        <input
          type="text"
          className="yt-input"
          placeholder="e.g. https://www.youtube.com/@veritasium"
          value={channelUrl}
          onChange={(e) => setChannelUrl(e.target.value)}
          disabled={loading}
        />

        <label className="yt-label">Max Videos (1–100)</label>
        <input
          type="number"
          className="yt-input yt-input-small"
          min={1}
          max={100}
          value={maxVideos}
          onChange={(e) => setMaxVideos(Math.min(100, Math.max(1, parseInt(e.target.value) || 10)))}
          disabled={loading}
        />

        <button
          className="yt-btn"
          onClick={handleDownload}
          disabled={loading || !channelUrl.trim()}
        >
          {loading ? 'Fetching...' : 'Download Channel Data'}
        </button>
      </div>

      {loading && (
        <div className="yt-progress-wrap">
          <div className="yt-progress-bar">
            <div className="yt-progress-fill" />
          </div>
          <p className="yt-progress-text">{progress}</p>
        </div>
      )}

      {!loading && progress && !error && (
        <p className="yt-success">{progress}</p>
      )}

      {error && <p className="yt-error">{error}</p>}

      {result && (
        <div className="yt-result">
          <div className="yt-result-header">
            <h3>{result.channelName}</h3>
            <span className="yt-result-count">{result.videos.length} videos</span>
          </div>
          <div className="yt-video-list">
            {result.videos.map((v, i) => (
              <div key={i} className="yt-video-item">
                {v.thumbnail_url && (
                  <img src={v.thumbnail_url} alt={v.title} className="yt-thumb" />
                )}
                <div className="yt-video-info">
                  <a href={v.video_url} target="_blank" rel="noreferrer" className="yt-video-title">
                    {v.title}
                  </a>
                  <div className="yt-video-meta">
                    <span>👁 {v.view_count?.toLocaleString()}</span>
                    <span>👍 {v.like_count?.toLocaleString()}</span>
                    <span>💬 {v.comment_count?.toLocaleString()}</span>
                    <span>📅 {v.release_date ? new Date(v.release_date).toLocaleDateString() : ''}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="yt-btn yt-btn-download" onClick={handleSaveJson}>
            ⬇ Download JSON
          </button>
        </div>
      )}
    </div>
  );
}
