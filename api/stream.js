const { Readable } = require('node:stream');

function allowedHost(hostname) {
  return hostname === 'googlevideo.com' || hostname.endsWith('.googlevideo.com');
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('GET is required.');

  try {
    const target = new URL(req.query.url || '');
    if (target.protocol !== 'https:' || !allowedHost(target.hostname)) {
      return res.status(400).send('Unsupported media host.');
    }

    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(target, { headers });
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).send('The media stream expired. Analyze the link again.');
    }

    res.statusCode = upstream.status;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch (_) {
    return res.status(400).send('Invalid or expired media URL.');
  }
};
