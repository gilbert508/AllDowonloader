export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { url, isAudio } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Valid URL is required.' });

  url = url.trim();

  // Normalize YouTube link and extract ID
  const ytMatch = url.match(/(?:shorts\/|v=|\/embed\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  const ytId = ytMatch ? ytMatch[1] : null;

  let title = "Media Download";
  let thumb = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800";

  if (ytId) {
    thumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
      if (oe.ok) {
        const oeData = await oe.json();
        title = oeData.title || title;
      }
    } catch (_) {}
  }

  const safeTitle = title.replace(/[\\/*?:"<>|]/g, '').trim().slice(0, 80);
  const cleanTargetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url;

  // Multi-Node Cobalt instances with fallback routing
  const COBALT_SERVERS = [
    "https://cobalt-api.kwiatekmiki.com",
    "https://cobalt.hyper.lol",
    "https://api.wuk.sh"
  ];

  const payload = {
    url: cleanTargetUrl,
    downloadMode: isAudio ? "audio" : "auto",
    videoQuality: "1080",
    audioFormat: "mp3",
    filenameStyle: "basic",
    youtubeVideoCodec: "h264"
  };

  for (const server of COBALT_SERVERS) {
    try {
      const response = await fetch(server, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const data = await response.json();
        const streamUrl = data.url || (data.picker && data.picker[0]?.url);
        if (streamUrl) {
          return res.status(200).json({
            success: true,
            title: safeTitle,
            thumb: thumb,
            url: streamUrl,
            filename: `${safeTitle}.${isAudio ? 'mp3' : 'mp4'}`
          });
        }
      }
    } catch (_) {
      continue;
    }
  }

  // Backup Engine: High-reliability Piped network for YouTube
  if (ytId) {
    const PIPED_SERVERS = [
      "https://pipedapi.kavin.rocks",
      "https://api.piped.privacydev.net",
      "https://pipedapi.drgns.space"
    ];

    for (const host of PIPED_SERVERS) {
      try {
        const pipedRes = await fetch(`${host}/streams/${ytId}`, {
          signal: AbortSignal.timeout(4000)
        });

        if (pipedRes.ok) {
          const pipedData = await pipedRes.json();
          const videoTitle = (pipedData.title || safeTitle).replace(/[\\/*?:"<>|]/g, '').trim().slice(0, 80);

          if (isAudio) {
            const audioStreams = (pipedData.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            if (audioStreams.length > 0) {
              return res.status(200).json({
                success: true,
                title: videoTitle,
                thumb: thumb,
                url: audioStreams[0].url,
                filename: `${videoTitle}.mp3`
              });
            }
          } else {
            const videoStreams = (pipedData.videoStreams || [])
              .filter(s => s.format === 'MPEG_4' || s.mimeType?.includes('mp4'))
              .sort((a, b) => (b.height || 0) - (a.height || 0));

            if (videoStreams.length > 0) {
              return res.status(200).json({
                success: true,
                title: videoTitle,
                thumb: thumb,
                url: videoStreams[0].url,
                filename: `${videoTitle}.mp4`
              });
            }
          }
        }
      } catch (_) {
        continue;
      }
    }
  }

  return res.status(500).json({
    error: "Media servers could not extract this video stream. Please check link validity and try again."
  });
}
