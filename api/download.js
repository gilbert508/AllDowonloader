export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { url, isAudio } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required' });

  url = url.trim();

  // 1. Clean URL and isolate YouTube Video ID
  const ytMatch = url.match(/(?:shorts\/|v=|\/embed\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  const ytId = ytMatch ? ytMatch[1] : null;

  // ------------------------------------------------------------------
  // STRATEGY A: High-Speed YouTube Invidious Cluster (Parallel Race)
  // ------------------------------------------------------------------
  if (ytId) {
    const INVIDIOUS_INSTANCES = [
      'https://inv.nadeko.net',
      'https://invidious.private.coffee',
      'https://invidious.nerdvpn.de',
      'https://invidious.f5.si'
    ];

    try {
      // Race all instances simultaneously — fastest response wins in < 1.5 seconds
      const streamData = await Promise.any(
        INVIDIOUS_INSTANCES.map(async (host) => {
          const response = await fetch(`${host}/api/v1/videos/${ytId}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(4000)
          });

          if (!response.ok) throw new Error(`Node ${host} returned ${response.status}`);
          const data = await response.json();
          if (!data || (!data.formatStreams && !data.adaptiveFormats)) throw new Error('No streams');
          return data;
        })
      );

      const title = (streamData.title || 'video').replace(/[\\/*?:"<>|]/g, '').trim().slice(0, 70);

      if (isAudio) {
        // Find best audio stream
        const audios = (streamData.adaptiveFormats || [])
          .filter(f => f.type?.includes('audio') || f.container === 'm4a' || f.container === 'webm')
          .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

        if (audios.length > 0) {
          return res.status(200).json({
            url: audios[0].url,
            filename: `${title}.mp3`
          });
        }
      } else {
        // Pick best progressive MP4 stream (audio + video combined, 100% playable on iOS & Android)
        const videos = (streamData.formatStreams || [])
          .filter(f => f.container === 'mp4' || f.type?.includes('mp4'))
          .sort((a, b) => {
            const hA = parseInt(a.resolution || a.qualityLabel) || 0;
            const hB = parseInt(b.resolution || b.qualityLabel) || 0;
            return hB - hA;
          });

        if (videos.length > 0) {
          return res.status(200).json({
            url: videos[0].url,
            filename: `${title}.mp4`
          });
        }
      }
    } catch (e) {
      // If Invidious race failed, proceed to Cobalt cluster fallback below
    }
  }

  // ------------------------------------------------------------------
  // STRATEGY B: Multi-Platform Cobalt Cluster (For Instagram, FB & YT)
  // ------------------------------------------------------------------
  const COBALT_NODES = [
    'https://cobalt-api.kwiatekmiki.com',
    'https://cobalt.hyper.lol',
    'https://api.wuk.sh',
    'https://dl.khann.me'
  ];

  const payload = {
    url: ytId ? `https://www.youtube.com/watch?v=${ytId}` : url,
    downloadMode: isAudio ? 'audio' : 'auto',
    videoQuality: '1080',
    audioFormat: 'mp3',
    filenameStyle: 'basic'
  };

  try {
    const cobaltResult = await Promise.any(
      COBALT_NODES.map(async (node) => {
        const response = await fetch(node, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0'
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(4500)
        });

        if (!response.ok) throw new Error(`Node ${node} rejected`);
        const data = await response.json();

        if (data.url) return { url: data.url, filename: data.filename || (isAudio ? 'audio.mp3' : 'video.mp4') };
        if (data.picker && data.picker.length > 0) return { url: data.picker[0].url, filename: isAudio ? 'audio.mp3' : 'video.mp4' };
        throw new Error('Invalid format');
      })
    );

    return res.status(200).json(cobaltResult);
  } catch (err) {
    return res.status(500).json({
      error: 'Media provider was unreachable. Please try again in a few seconds.'
    });
  }
}
