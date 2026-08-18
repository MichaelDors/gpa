// src/worker.js - Cloudflare Worker GitHub Proxy for GPA Finder
var DEFAULT_GITHUB_BASE = "https://raw.githubusercontent.com/MichaelDors/gpa/main";

var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }

    const githubBase = env && env.GITHUB_BASE_URL ? env.GITHUB_BASE_URL.replace(/\/$/, "") : DEFAULT_GITHUB_BASE;
    const targetUrl = `${githubBase}${pathname}`;
    const ext = pathname.substring(pathname.lastIndexOf(".")).toLowerCase();
    const contentType = MIME_TYPES[ext] || "text/plain; charset=utf-8";

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Cloudflare-Worker-GPA-Proxy"
        },
        cf: {
          cacheTtl: 60, // Cache at Cloudflare edge for 60 seconds
          cacheEverything: true
        }
      });

      if (!response.ok) {
        return new Response(`File not found on GitHub (${response.status}): ${pathname}\nURL: ${targetUrl}`, {
          status: response.status,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      const body = await response.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=60, s-maxage=300",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (err) {
      return new Response(`Error fetching from GitHub: ${err.message}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};

export {
  worker_default as default
};
