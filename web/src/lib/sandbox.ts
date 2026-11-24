import fs from "node:fs";
import path from "node:path";

/** Read BASE_URL and KEY strictly on the server (from process.env or parent ../.env). */
export function getSandboxConfig(): { baseUrl: string | null; apiKey: string | null } {
  let baseUrl = process.env.BASE_URL || null;
  let apiKey = process.env.KEY || null;

  if (!baseUrl || !apiKey) {
    const candidates = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "../.env"),
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const idx = line.indexOf("=");
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (k === "BASE_URL" && !baseUrl) baseUrl = v;
        if (k === "KEY" && !apiKey) apiKey = v;
      }
    }
  }
  return { baseUrl, apiKey };
}

export async function sandboxFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const { baseUrl, apiKey } = getSandboxConfig();
  if (!baseUrl || !apiKey) {
    throw new Error("Sandbox credentials unavailable");
  }
  const url = `${baseUrl.replace(/\/$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
