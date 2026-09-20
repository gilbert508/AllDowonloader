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

  // Strip tracking parameters like ?feature=share
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
  const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url;

  // 1. Primary Engine: Active Cobalt Community Cluster (v10 payload)
  const COBALT_INSTANCES = [
    "https://cobalt-api.kwiatekmiki.com",
    "https://cobalt.hyper.lol",
    "https://api.wuk.sh"
  ];

  const cobaltPayload = {
    url: targetUrl,
    downloadMode: isAudio ? "audio" : "auto",
    videoQuality: "1080",
    audioFormat: "mp3",
    filenameStyle: "basic"
  };

  for (const host of COBALT_INSTANCES) {
    try {
      const response = await fetch(host, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        body: JSON.stringify(cobaltPayload),
        signal: AbortSignal.timeout(4500)
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

  // 2. Secondary Engine: Piped Direct CDN Streams (for YouTube)
  if (ytId) {
    const PIPED_INSTANCES = [
      "https://pipedapi.kavin.rocks",
      "https://api.piped.privacydev.net",
      "https://pipedapi.drgns.space"
    ];

    for (const host of PIPED_INSTANCES) {
      try {
        const pipedRes = await fetch(`${host}/streams/${ytId}`, {
          signal: AbortSignal.timeout(4500)
        });

        if (pipedRes.ok) {
          const pipedData = await pipedRes.json();
          const streamTitle = (pipedData.title || safeTitle).replace(/[\\/*?:"<>|]/g, '').trim().slice(0, 80);

          if (isAudio) {
            const audios = (pipedData.audioStreams || []).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
            if (audios.length > 0) {
              return res.status(200).json({
                success: true,
                title: streamTitle,
                thumb: thumb,
                url: audios[0].url,
                filename: `${streamTitle}.mp3`
              });
            }
          } else {
            const videos = (pipedData.videoStreams || [])
              .filter(s => s.format === 'MPEG_4' || s.mimeType?.includes('mp4'))
              .sort((a, b) => (b.height || 0) - (a.height || 0));

            if (videos.length > 0) {
              return res.status(200).json({
                success: true,
                title: streamTitle,
                thumb: thumb,
                url: videos[0].url,
                filename: `${streamTitle}.mp4`
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
    error: "Extraction nodes are currently busy. Please try again in a few moments."
  });
}
