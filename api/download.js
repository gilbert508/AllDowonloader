export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let { url, isAudio, quality } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // 1. Sanitize & Normalize URL (Clean tracking tokens like ?feature=share)
  url = url.trim();
  const shortsMatch = url.match(/(?:shorts\/|v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  let ytId = shortsMatch ? shortsMatch[1] : null;
  let normalizedUrl = url;

  if (ytId) {
    normalizedUrl = `https://www.youtube.com/watch?v=${ytId}`;
  }

  // -------------------------------------------------------------
  // Engine 1: Piped Video API (High-speed, never blocked by YouTube)
  // -------------------------------------------------------------
  if (ytId) {
    const PIPED_INSTANCES = [
      'https://pipedapi.kavin.rocks',
      'https://api.piped.privacydev.net',
      'https://pipedapi.drgns.space'
    ];

    for (const host of PIPED_INSTANCES) {
      try {
        const pipedRes = await fetch(`${host}/streams/${ytId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4500)
        });

        if (pipedRes.ok) {
          const data = await pipedRes.json();
          const cleanTitle = (data.title || 'media').replace(/[\\/*?:"<>|]/g, '').slice(0, 80);

          if (isAudio) {
            const audioStreams = (data.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            if (audioStreams.length > 0) {
              return res.status(200).json({
                url: audioStreams[0].url,
                filename: `${cleanTitle}.mp3`
              });
            }
          } else {
            // Pick highest resolution direct video stream
            const videoStreams = (data.videoStreams || [])
              .filter(s => s.format === 'MPEG_4' || s.mimeType?.includes('mp4'))
              .sort((a, b) => (b.height || 0) - (a.height || 0));

            if (videoStreams.length > 0) {
              return res.status(200).json({
                url: videoStreams[0].url,
                filename: `${cleanTitle}.mp4`
              });
            }
          }
        }
      } catch (e) {
        // Continue to next instance or engine
      }
    }
  }

  // -------------------------------------------------------------
  // Engine 2: Multi-Node Cobalt Ring (For Instagram, Facebook & YT)
  // -------------------------------------------------------------
  const COBALT_NODES = [
    'https://cobalt-api.kwiatekmiki.com',
    'https://cobalt.hyper.lol',
    'https://api.wuk.sh',
    'https://co.wuk.sh'
  ];

  const payload = {
    url: normalizedUrl,
    downloadMode: isAudio ? 'audio' : 'auto',
    videoQuality: quality === 'max' ? '1080' : (quality || '720'),
    audioFormat: 'mp3',
    audioBitrate: '320',
    filenameStyle: 'basic',
    youtubeVideoCodec: 'h264'
  };

  for (const node of COBALT_NODES) {
    try {
      const response = await fetch(node, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          return res.status(200).json({
            url: data.url,
            filename: data.filename || (isAudio ? 'media.mp3' : 'media.mp4')
          });
        }
        if (data.picker && data.picker.length > 0) {
          return res.status(200).json({
            url: data.picker[0].url,
            filename: isAudio ? 'media.mp3' : 'media.mp4'
          });
        }
      }
    } catch (err) {
      continue;
    }
  }

  return res.status(500).json({
    error: 'All extraction nodes were busy. Please try again in a few moments.'
  });
}
