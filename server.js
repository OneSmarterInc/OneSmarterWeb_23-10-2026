import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "dist");

// Load .env if present and not already set
const envPath = path.resolve(__dirname, ".env");
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  } catch (err) {
    console.warn("Could not read .env file:", err.message);
  }
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Security headers matching vercel.json
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://stats.g.doubleclick.net; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net; manifest-src 'self'; worker-src 'self'; form-action 'self'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Frame-Options": "DENY",
};

// Redirects matching vercel.json
const REDIRECTS = new Map([
  ["/platforms/telecom-expense-management", "/platforms/bill-audit-erp-bill-pay"],
  ["/technology-solutions/telecom-expense-management", "/platforms/bill-audit-erp-bill-pay"],
  ["/platforms/hipaa-compliant-ticketing", "/platforms/hipaa-regulated-ticketing"],
  ["/insights", "/"],
]);

// MIME types dictionary
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Lazy loaded API route handlers
const apiRoutes = {
  "/api/agents/mira/chat": () => import("./api/agents/mira/chat.js"),
  "/api/agents/theo/chat": () => import("./api/agents/theo/chat.js"),
  "/api/agents/elena/chat": () => import("./api/agents/elena/chat.js"),
  "/api/agents/ravi/chat": () => import("./api/agents/ravi/chat.js"),
  "/api/agents/selene/chat": () => import("./api/agents/selene/chat.js"),
  "/api/agents/cafe/restoration": () => import("./api/agents/cafe/restoration.js"),
  "/api/agents/cafe/generate": () => import("./api/agents/cafe/generate.js"),
  "/api/agents/cafe/reply": () => import("./api/agents/cafe/reply.js"),
};

// Helper to serve a static file with optional gzip compression
function serveFile(filePath, req, res, statusCode = 200) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);

    // Apply security headers
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(k, v);
    }

    // Cache control policy
    if (filePath.includes(`${path.sep}assets${path.sep}`) || filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    }

    // Compression support
    const acceptEncoding = req.headers["accept-encoding"] || "";
    const isCompressible = /^(text\/|application\/javascript|application\/json|image\/svg\+xml)/.test(contentType);

    if (isCompressible && /\bgzip\b/.test(acceptEncoding)) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      const rawStream = fs.createReadStream(filePath);
      const gzipStream = zlib.createGzip();
      rawStream.pipe(gzipStream).pipe(res);
    } else {
      res.setHeader("Content-Length", stats.size);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // Apply security headers to all responses
    for (const [header, val] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(header, val);
    }

    // Check redirects
    if (REDIRECTS.has(pathname)) {
      res.statusCode = 301;
      res.setHeader("Location", REDIRECTS.get(pathname));
      res.end();
      return;
    }

    // Health check endpoint
    if (pathname === "/api/health" || pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          env: process.env.NODE_ENV || "production",
        })
      );
      return;
    }

    // Agent API endpoints
    if (pathname.startsWith("/api/agents/")) {
      const loader = apiRoutes[pathname];
      if (loader) {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch {
          req.body = {};
        }

        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(data));
          return res;
        };

        const module = await loader();
        const handler = module.default;
        await handler(req, res);
        return;
      }

      // If an unknown /api/ route is requested
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "not_found", message: `Endpoint ${pathname} not found.` }));
      return;
    }

    // Static files in dist/
    // Sanitize path against directory traversal
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
    let resolvedFilePath = path.join(DIST_DIR, safePath);

    // If requesting directory or root, default to index.html
    if (fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isDirectory()) {
      resolvedFilePath = path.join(resolvedFilePath, "index.html");
    }

    // If file exists in dist, serve it
    if (fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isFile()) {
      serveFile(resolvedFilePath, req, res);
      return;
    }

    // Otherwise, SPA fallback: serve dist/index.html
    const indexPath = path.join(DIST_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      serveFile(indexPath, req, res, 200);
      return;
    }

    // If dist/index.html is missing
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Production build not found. Please run 'npm run build' first.");
  } catch (err) {
    console.error("Unhandled server error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "internal_server_error", message: err.message }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OneSmarter Production Server running at http://${HOST}:${PORT}`);
  console.log(`Serving static files from: ${DIST_DIR}`);
});

// Graceful shutdown
const handleSignal = (signal) => {
  console.log(`Received ${signal}. Gracefully shutting down...`);
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force shutdown if taking too long
  setTimeout(() => {
    console.error("Forcefully terminating server.");
    process.exit(1);
  }, 5000).unref();
};

process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGINT", () => handleSignal("SIGINT"));
