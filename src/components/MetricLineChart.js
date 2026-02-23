import { useState, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(15, 15, 35, 0.92)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10,
      padding: '0.65rem 0.9rem',
      fontSize: '0.82rem',
      color: '#e2e8f0',
    }}>
      <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: '#fff' }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ margin: '0.15rem 0', color: p.color }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</strong>
        </p>
      ))}
    </div>
  );
}

export default function MetricLineChart({ data, field }) {
  const [enlarged, setEnlarged] = useState(false);
  const chartRef = useRef(null);

  if (!data?.length) return null;

  const handleDownload = () => {
    const canvas = chartRef.current?.querySelector('canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = `${field}_chart.png`;
      link.href = canvas.toDataURL();
      link.click();
      return;
    }
    // Fallback: download as CSV
    const csv = ['date,value', ...data.map(d => `${d.date},${d.value}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${field}_data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chart = (height = 280) => (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
          axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
          tickLine={false}
          angle={-30}
          textAnchor="end"
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={65}
          tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
        <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.65)' }} />
        <Line
          type="monotone"
          dataKey="value"
          name={field}
          stroke="#818cf8"
          strokeWidth={2}
          dot={{ r: 3, fill: '#818cf8' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <>
      <div className="metric-chart-wrap" ref={chartRef}>
        <div className="metric-chart-header">
          <p className="metric-chart-label">{field} over time</p>
          <div className="metric-chart-actions">
            <button className="chart-action-btn" onClick={() => setEnlarged(true)} title="Enlarge">⛶</button>
            <button className="chart-action-btn" onClick={handleDownload} title="Download">⬇</button>
          </div>
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => setEnlarged(true)}>
          {chart(280)}
        </div>
      </div>

      {enlarged && (
        <div className="chart-lightbox" onClick={() => setEnlarged(false)}>
          <div className="chart-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="chart-lightbox-header">
              <span>{field} over time</span>
              <button onClick={() => setEnlarged(false)}>✕</button>
            </div>
            {chart(420)}
          </div>
        </div>
      )}
    </>
  );
}
