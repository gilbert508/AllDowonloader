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

  // Normalize YouTube URLs (strip ?feature=share, reels, shorts parameters)
  const ytMatch = url.match(/(?:shorts\/|v=|\/embed\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  const ytId = ytMatch ? ytMatch[1] : null;

  let title = "media_download";
  let thumb = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800";

  // Step 1: Resolve metadata
  if (ytId) {
    thumb = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    try {
      const oeRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
      if (oeRes.ok) {
        const oeData = await oeRes.json();
        title = oeData.title || title;
      }
    } catch (_) {}
  }

  const safeTitle = title.replace(/[\\/*?:"<>|]/g, '').trim().slice(0, 80);
  const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url;

  // Step 2: High-speed multi-node resolver pool
  const RESOLVER_ENDPOINTS = [
    {
      url: "https://cobalt-api.kwiatekmiki.com",
      payload: {
        url: targetUrl,
        downloadMode: isAudio ? "audio" : "auto",
        videoQuality: "1080",
        audioFormat: "mp3",
        filenameStyle: "basic",
        youtubeVideoCodec: "h264"
      }
    },
    {
      url: "https://cobalt.hyper.lol",
      payload: {
        url: targetUrl,
        downloadMode: isAudio ? "audio" : "auto",
        videoQuality: "1080",
        audioFormat: "mp3",
        filenameStyle: "basic"
      }
    },
    {
      url: "https://api.wuk.sh",
      payload: {
        url: targetUrl,
        downloadMode: isAudio ? "audio" : "auto",
        videoQuality: "720",
        audioFormat: "mp3"
      }
    }
  ];

  try {
    const resolvedStream = await Promise.any(
      RESOLVER_ENDPOINTS.map(async (node) => {
        const response = await fetch(node.url, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          },
          body: JSON.stringify(node.payload),
          signal: AbortSignal.timeout(5500)
        });

        if (!response.ok) throw new Error("Node failed");
        const data = await response.json();

        if (data.url) {
          return {
            streamUrl: data.url,
            filename: `${safeTitle}.${isAudio ? 'mp3' : 'mp4'}`
          };
        }

        if (data.picker && data.picker.length > 0) {
          return {
            streamUrl: data.picker[0].url,
            filename: `${safeTitle}.${isAudio ? 'mp3' : 'mp4'}`
          };
        }

        throw new Error("No stream found");
      })
    );

    return res.status(200).json({
      success: true,
      title: safeTitle,
      thumb: thumb,
      url: resolvedStream.streamUrl,
      filename: resolvedStream.filename
    });
  } catch (err) {
    // Fallback: If external clusters reject cloud IPs, provide direct CDN pass-through
    if (ytId) {
      return res.status(200).json({
        success: true,
        title: safeTitle,
        thumb: thumb,
        url: `https://www.youtube-nocookie.com/embed/${ytId}`,
        filename: `${safeTitle}.mp4`,
        isEmbed: true
      });
    }

    return res.status(500).json({
      error: "Extraction servers are currently under load. Please retry in a few seconds."
    });
  }
}
