const resolver = require('./resolve');

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body, null, 2));
}

module.exports = async (req, res) => {
  const url = String(req.query?.url || '').trim();
  const id = resolver.youtubeId(url);
  if (!id) return json(res, 400, { ok: false, stage: 'url', error: 'A valid YouTube URL is required.' });

  const result = {
    ok: false,
    url,
    videoId: id,
    stage: 'youtube-player',
    checkedAt: new Date().toISOString()
  };

  try {
    const media = await resolver.resolveYouTube(url, id, false);
    result.stage = 'media-stream';
    result.title = media.title;
    result.filename = media.filename;
    result.thumbnail = media.thumb;

    const probe = await fetch(media.directStreamUrl, {
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'Mozilla/5.0' }
    });
    result.streamStatus = probe.status;
    result.streamContentType = probe.headers.get('content-type');
    result.streamBytes = (await probe.arrayBuffer()).byteLength;
    result.ok = probe.ok && result.streamBytes > 0;
    result.stage = result.ok ? 'complete' : 'media-stream';
    if (!result.ok) result.error = 'The extracted media URL did not return bytes.';
    return json(res, result.ok ? 200 : 502, result);
  } catch (error) {
    result.error = error.message || 'The server-side extraction failed.';
    return json(res, 502, result);
  }
};