const { Readable } = require('node:stream');

function allowedHost(hostname) {
  const configuredCobaltHost = process.env.COBALT_API_URL ? new URL(process.env.COBALT_API_URL).hostname : '';
  return hostname === 'googlevideo.com'
    || hostname.endsWith('.googlevideo.com')
    || (configuredCobaltHost && hostname === configuredCobaltHost);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).setHeader('Content-Type', 'text/plain');
    return res.end('GET is required.');
  }

  try {
    const target = new URL(req.query.url || '');
    if (target.protocol !== 'https:' || !allowedHost(target.hostname)) {
      res.status(400).setHeader('Content-Type', 'text/plain');
      return res.end('Unsupported media host.');
    }

    const requestHeaders = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) requestHeaders.Range = req.headers.range;
    const upstream = await fetch(target, { headers: requestHeaders });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).setHeader('Content-Type', 'text/plain');
      return res.end('The media stream expired. Analyze the link again.');
    }

    const filename = String(req.query.filename || 'download').replace(/[\r\n"\\/]/g, '_');
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch (_) {
    res.status(400).setHeader('Content-Type', 'text/plain');
    return res.end('Invalid or expired media URL.');
  }
};
