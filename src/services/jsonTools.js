// ── JSON Tool Declarations (for YouTube video data) ────────────────────────────
// These tools operate on locally saved JSON data (array of video objects).
// Fields available: title, description, duration, release_date, view_count,
//                   like_count, comment_count, video_url, thumbnail_url, transcript

export const JSON_TOOL_DECLARATIONS = [
  {
    name: 'compute_stats_json',
    description:
      'Compute descriptive statistics (mean, median, std, min, max) for a numeric field in the loaded JSON video data. ' +
      'Use when the user asks for statistics, averages, or distributions of a numeric field like view_count, like_count, comment_count, or duration.',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'The numeric field name. One of: view_count, like_count, comment_count, duration.',
        },
      },
      required: ['field'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plot a numeric metric over time for the loaded YouTube channel videos. ' +
      'Use when the user asks to plot, chart, or visualize a metric over time or by release date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'The numeric field to plot. One of: view_count, like_count, comment_count, duration.',
        },
      },
      required: ['field'],
    },
  },
  {
    name: 'play_video',
    description:
      'Display a clickable video card for a YouTube video from the loaded JSON data. ' +
      'Use when the user says "play", "open", "show", or "watch" a video. ' +
      'Accepts a title keyword, ordinal (first, second, third, last), or attribute (most viewed, most liked, longest).',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description:
            'How to find the video. Examples: "first", "most viewed", "quantum mechanics", "last", "most liked".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt using AI image generation. ' +
      'Use when the user asks to generate, create, draw, or make an image. ' +
      'Optionally uses an anchor image the user has uploaded.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'A detailed text description of the image to generate.',
        },
      },
      required: ['prompt'],
    },
  },
];

// ── Math helpers ───────────────────────────────────────────────────────────────

const numericValues = (rows, field) =>
  rows.map((r) => parseFloat(r[field])).filter((v) => !isNaN(v));

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(2);

// ── Field resolver ─────────────────────────────────────────────────────────────

const resolveField = (rows, name) => {
  if (!rows.length || !name) return name;
  const keys = Object.keys(rows[0]);
  if (keys.includes(name)) return name;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(name);
  return keys.find((k) => norm(k) === target) || name;
};

// ── Tool executor ──────────────────────────────────────────────────────────────

export const executeJsonTool = async (toolName, args, jsonRows, anchorImage, generateImageFn) => {
  console.log('[JSON Tool]', toolName, args);

  switch (toolName) {

    case 'compute_stats_json': {
      const field = resolveField(jsonRows, args.field);
      const vals = numericValues(jsonRows, field);
      if (!vals.length) return { error: `No numeric values found for field "${field}"` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        field,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'plot_metric_vs_time': {
      const field = resolveField(jsonRows, args.field);
      // Sort by release_date ascending
      const sorted = [...jsonRows].sort((a, b) => {
        const da = new Date(a.release_date || 0);
        const db = new Date(b.release_date || 0);
        return da - db;
      });
      const data = sorted
        .map((v) => ({
          date: v.release_date ? new Date(v.release_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '',
          value: parseFloat(v[field]) || 0,
          title: v.title || '',
        }))
        .filter((d) => d.date);

      if (!data.length) return { error: `No data found for field "${field}"` };

      return {
        _chartType: 'line_chart',
        field,
        data,
      };
    }

    case 'play_video': {
      const query = (args.query || '').toLowerCase().trim();
      let video = null;

      // Ordinal matching
      const ordinalMap = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2,
                           fourth: 3, '4th': 3, fifth: 4, '5th': 4, last: jsonRows.length - 1 };
      if (ordinalMap[query] !== undefined) {
        video = jsonRows[ordinalMap[query]];
      }

      // Attribute matching
      if (!video) {
        if (query.includes('most view') || query.includes('most watch')) {
          video = [...jsonRows].sort((a, b) => (b.view_count || 0) - (a.view_count || 0))[0];
        } else if (query.includes('most like') || query.includes('popular')) {
          video = [...jsonRows].sort((a, b) => (b.like_count || 0) - (a.like_count || 0))[0];
        } else if (query.includes('most comment')) {
          video = [...jsonRows].sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0))[0];
        } else if (query.includes('longest') || query.includes('longest')) {
          video = [...jsonRows].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
        } else if (query.includes('newest') || query.includes('latest') || query.includes('recent')) {
          video = [...jsonRows].sort((a, b) => new Date(b.release_date) - new Date(a.release_date))[0];
        } else if (query.includes('oldest') || query.includes('earliest')) {
          video = [...jsonRows].sort((a, b) => new Date(a.release_date) - new Date(b.release_date))[0];
        }
      }

      // Keyword search in title
      if (!video) {
        video = jsonRows.find((v) => (v.title || '').toLowerCase().includes(query));
      }

      // Default to first video
      if (!video) video = jsonRows[0];

      if (!video) return { error: 'No videos found in the loaded JSON data' };

      return {
        _videoCard: true,
        title: video.title,
        thumbnailUrl: video.thumbnail_url || '',
        videoUrl: video.video_url,
        viewCount: video.view_count,
        likeCount: video.like_count,
        releaseDate: video.release_date,
      };
    }

    case 'generateImage': {
      if (!generateImageFn) return { error: 'Image generation not available' };
      try {
        const result = await generateImageFn(args.prompt, anchorImage);
        if (!result) return { error: 'Image generation returned no result' };
        return {
          _generatedImage: true,
          prompt: args.prompt,
          data: result.data,
          mimeType: result.mimeType,
        };
      } catch (err) {
        return { error: `Image generation failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};
