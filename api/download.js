export default async function handler(req, res) {
  // Enable universal CORS for mobile and desktop browsers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, isAudio, quality } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Multi-engine failover pool
  const BACKEND_NODES = [
    {
      endpoint: 'https://cobalt-api.kwiatekmiki.com',
      format: 'cobalt-v10'
    },
    {
      endpoint: 'https://cobalt.hyper.lol',
      format: 'cobalt-v10'
    },
    {
      endpoint: 'https://api.wuk.sh',
      format: 'cobalt-v10'
    },
    {
      endpoint: 'https://co.wuk.sh',
      format: 'cobalt-v10'
    }
  ];

  const cobaltPayload = {
    url: url,
    downloadMode: isAudio ? 'audio' : 'auto',
    videoQuality: quality === 'max' ? '1080' : (quality || '720'),
    audioFormat: 'mp3',
    audioBitrate: '320',
    filenameStyle: 'basic',
    youtubeVideoCodec: 'h264'
  };

  let lastError = 'Failed to extract stream from media servers.';

  for (const node of BACKEND_NODES) {
    try {
      const response = await fetch(node.endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(cobaltPayload)
      });

      if (response.ok) {
        const data = await response.json();

        // Standard direct tunnel download link
        if (data.url) {
          return res.status(200).json({
            url: data.url,
            filename: data.filename || (isAudio ? 'audio.mp3' : 'video.mp4')
          });
        }

        // Carousel / Multi-item picker
        if (data.picker && data.picker.length > 0) {
          return res.status(200).json({
            url: data.picker[0].url,
            filename: isAudio ? 'audio.mp3' : 'video.mp4'
          });
        }

        if (data.text) lastError = data.text;
      } else {
        const err = await response.json().catch(() => ({}));
        if (err.text) lastError = err.text;
      }
    } catch (err) {
      // Continue to next node in failover ring
      continue;
    }
  }

  return res.status(500).json({ error: lastError });
}
