const YOUTUBE_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player';

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function youtubeId(value) {
  const match = value.match(/(?:shorts\/|watch\?v=|[?&]v=|youtu\.be\/|embed\/|v\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function safeFilename(title, extension) {
  const cleaned = String(title || 'download')
    .replace(/[\\/*?:"<>|]/g, '')
    .trim()
    .slice(0, 80) || 'download';
  return `${cleaned}.${extension}`;
}

async function resolveYouTube(url, id, isAudio) {
  const clients = [
    { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30 },
    { clientName: 'TVHTML5', clientVersion: '7.20241010.18.00' },
    { clientName: 'WEB', clientVersion: '2.20240926.01.00' }
  ];

  let lastReason = 'YouTube did not return a playable stream.';
  for (const client of clients) {
    try {
      const response = await fetch(`${YOUTUBE_PLAYER_URL}?prettyPrint=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ videoId: id, context: { client } })
      });
      const data = await response.json();
      const playability = data.playabilityStatus;
      if (!response.ok || playability?.status === 'ERROR') {
        lastReason = playability?.reason || lastReason;
        continue;
      }

      const title = data.videoDetails?.title || 'YouTube download';
      const formats = [
        ...(data.streamingData?.formats || []),
        ...(data.streamingData?.adaptiveFormats || [])
      ].filter((format) => format.url && format.mimeType);

      const candidates = isAudio
        ? formats.filter((format) => format.mimeType.startsWith('audio/'))
        : formats.filter((format) => format.mimeType.includes('video/mp4') && format.mimeType.includes('audio'));
      candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0) || (b.height || 0) - (a.height || 0));

      if (candidates[0]) {
        const format = candidates[0];
        const extension = isAudio ? (format.mimeType.includes('mp4') ? 'm4a' : 'webm') : 'mp4';
        return {
          title,
          thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          directStreamUrl: format.url,
          filename: safeFilename(title, extension)
        };
      }
    } catch (error) {
      lastReason = error.message || lastReason;
    }
  }

  throw new Error(`YouTube extraction failed: ${lastReason}`);
}

async function resolveCobalt(url, isAudio) {
  const endpoint = process.env.COBALT_API_URL;
  if (!endpoint) {
    throw new Error('Instagram and Facebook downloads are not configured yet. Set COBALT_API_URL in Vercel.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      downloadMode: isAudio ? 'audio' : 'auto',
      videoQuality: '1080',
      audioFormat: 'mp3',
      alwaysProxy: true
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === 'error') {
    throw new Error(data.error?.code || `Provider returned HTTP ${response.status}`);
  }

  const item = data.url ? data : data.picker?.find((entry) => entry.type === 'video') || data.picker?.[0];
  if (!item?.url) throw new Error('The provider returned no downloadable media.');

  return {
    title: data.filename || 'Social media download',
    thumb: item.thumb || '',
    directStreamUrl: item.url,
    filename: data.filename || `download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST is required.' });

  try {
    const { url, audio } = req.body || {};
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return json(res, 400, { error: 'Enter a valid http(s) URL.' });
    }

    const id = youtubeId(url);
    const result = id
      ? await resolveYouTube(url, id, Boolean(audio))
      : await resolveCobalt(url, Boolean(audio));

    result.downloadUrl = `/api/download?url=${encodeURIComponent(result.directStreamUrl)}&filename=${encodeURIComponent(result.filename)}`;
    delete result.directStreamUrl;
    return json(res, 200, result);
  } catch (error) {
    return json(res, 502, { error: error.message || 'Media extraction failed.' });
  }
};
