// Simple offline static server for filming UI (no build step).
// Run: node server.js
// Open: http://localhost:8080

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8081;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null; // prevent path traversal
  return targetPath;
}

function send(res, code, headers, body) {
  res.writeHead(code, headers);
  res.end(body ?? "");
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";

    // ВАЖНО: не закрываем res до pipe()
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": "no-cache"
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Server Error");
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}


const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    // SPA-style routes: serve index.html for root or any unknown route without extension
    if (pathname === "/") pathname = "/index.html";

    const hasExt = path.extname(pathname) !== "";
    const requested = safeJoin(PUBLIC_DIR, pathname);
    if (!requested) {
      return send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Bad Request");
    }

    fs.stat(requested, (err, stat) => {
      if (!err && stat.isFile()) {
        return serveFile(req, res, requested);
      }

      if (!hasExt) {
        // fallback to SPA entry
        return serveFile(req, res, path.join(PUBLIC_DIR, "index.html"));
      }

      return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
    });
  } catch (e) {
    return send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`Offline UI server running: http://localhost:${PORT}`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
});
