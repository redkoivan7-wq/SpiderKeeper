import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extname } from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};

export async function serve(port = 8000, transform = (_, body) => body) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const relative = path === '/SpiderKeeper/' ? 'index.html' : path.slice('/SpiderKeeper/'.length);
    const type = types[extname(relative)];
    if (!path.startsWith('/SpiderKeeper/') || !/^(?:icons\/)?[a-z0-9._-]+$/.test(relative) || !type) {
      res.writeHead(404).end();
      return;
    }
    try {
      const file = await readFile(new URL('../' + relative, import.meta.url));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(transform(relative, file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/SpiderKeeper/' };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { url } = await serve(Number(process.argv[2] || 8000));
  console.log(url);
}
