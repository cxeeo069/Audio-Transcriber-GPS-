export default async function handler(req: any, res: any) {
  try {
    const audioUrl = req.query.url as string;
    if (!audioUrl) {
      return res.status(400).json({ error: 'URL is required' });
    }
    const response = await fetch(audioUrl);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch audio' });
    }
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch audio' });
  }
}
