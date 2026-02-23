export default function VideoCard({ title, thumbnailUrl, videoUrl }) {
  if (!videoUrl) return null;
  return (
    <a
      href={videoUrl}
      target="_blank"
      rel="noreferrer"
      className="video-card"
      title={`Watch: ${title}`}
    >
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt={title} className="video-card-thumb" />
      )}
      <div className="video-card-info">
        <span className="video-card-title">{title}</span>
        <span className="video-card-cta">▶ Watch on YouTube</span>
      </div>
    </a>
  );
}
