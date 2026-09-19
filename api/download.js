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

  // 1. Sanitize tracking parameters (?feature=share, ?si=, etc.)
  const ytMatch = url.match(/(?:shorts\/|v=|\/embed\/|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  const ytId = ytMatch ? ytMatch[1] : null;

  let title = "media_download";
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

  const cleanTitle = title.replace(/[\\/*?:"<>|]/g, '').trim().slice(0, 80);
  const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : url;

  // -------------------------------------------------------------
  // Primary Engine: High-Speed Direct Stream Resolver
  // -------------------------------------------------------------
  if (ytId) {
    try {
      // Step A: Request format analysis
      const analyzeRes = await fetch("https://www.y2mate.com/mates/analyzeV2/ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: `k_query=${encodeURIComponent(targetUrl)}&k_page=home&hl=en&q_auto=0`,
        signal: AbortSignal.timeout(6000)
      });

      if (analyzeRes.ok) {
        const analyzeData = await analyzeRes.json();
        if (analyzeData.status === "success" && analyzeData.links) {
          title = analyzeData.title || cleanTitle;
          let selectedKey = null;

          if (isAudio && analyzeData.links.mp3) {
            const keys = Object.keys(analyzeData.links.mp3);
            if (keys.length > 0) selectedKey = analyzeData.links.mp3[keys[0]].k;
          } else if (analyzeData.links.mp4) {
            const mp4 = analyzeData.links.mp4;
            const preferred = ["1080p", "720p", "auto", "480p", "360p"];
            for (const q of preferred) {
              for (const k in mp4) {
                if (mp4[k].q === q || k === q) {
                  selectedKey = mp4[k].k;
                  break;
                }
              }
              if (selectedKey) break;
            }
            if (!selectedKey) {
              const keys = Object.keys(mp4);
              if (keys.length > 0) selectedKey = mp4[keys[0]].k;
            }
          }

          if (selectedKey) {
            // Step B: Convert and fetch direct CDN download URL
            const convertRes = await fetch("https://www.y2mate.com/mates/convertV2/index", {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "X-Requested-With": "XMLHttpRequest"
              },
              body: `vid=${encodeURIComponent(analyzeData.vid)}&k=${encodeURIComponent(selectedKey)}`,
              signal: AbortSignal.timeout(6000)
            });

            if (convertRes.ok) {
              const convertData = await convertRes.json();
              if (convertData.status === "success" && convertData.dlink) {
                return res.status(200).json({
                  success: true,
                  title: cleanTitle,
                  thumb: thumb,
                  url: convertData.dlink,
                  filename: `${cleanTitle}.${isAudio ? 'mp3' : 'mp4'}`
                });
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // Secondary Engine: Multi-Network Cluster (Instagram, FB, YT backup)
  // -------------------------------------------------------------
  const CLUSTER_ENDPOINTS = [
    "https://cobalt-api.kwiatekmiki.com",
    "https://cobalt.hyper.lol",
    "https://api.wuk.sh"
  ];

  const payload = {
    url: targetUrl,
    downloadMode: isAudio ? "audio" : "auto",
    videoQuality: "1080",
    audioFormat: "mp3"
  };

  try {
    const clusterResult = await Promise.any(
      CLUSTER_ENDPOINTS.map(async (endpoint) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0"
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data.url) return data.url;
        if (data.picker && data.picker.length > 0) return data.picker[0].url;
        throw new Error();
      })
    );

    return res.status(200).json({
      success: true,
      title: cleanTitle,
      thumb: thumb,
      url: clusterResult,
      filename: `${cleanTitle}.${isAudio ? 'mp3' : 'mp4'}`
    });
  } catch (_) {}

  // -------------------------------------------------------------
  // Tertiary Fallback Engine
  // -------------------------------------------------------------
  try {
    const vkrRes = await fetch(`https://api.vkrdownloader.com/server?v=${encodeURIComponent(targetUrl)}`, {
      signal: AbortSignal.timeout(6000)
    });
    if (vkrRes.ok) {
      const vkrData = await vkrRes.json();
      if (vkrData.data && vkrData.data.downloads && vkrData.data.downloads.length > 0) {
        const downloads = vkrData.data.downloads;
        let chosen = isAudio
          ? downloads.find(x => x.format_id?.includes("audio") || x.extension === "mp3") || downloads[0]
          : downloads.find(x => x.extension === "mp4") || downloads[0];

        if (chosen && chosen.url) {
          return res.status(200).json({
            success: true,
            title: cleanTitle,
            thumb: vkrData.data.thumbnail || thumb,
            url: chosen.url,
            filename: `${cleanTitle}.${isAudio ? 'mp3' : 'mp4'}`
          });
        }
      }
    }
  } catch (_) {}

  return res.status(500).json({
    error: "Media servers could not extract this video stream. Please check link validity and try again."
  });
}
