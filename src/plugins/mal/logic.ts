import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const TOKENS_PATH = join(import.meta.dirname, "../.mal-tokens.json");

interface MALTokens {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  expires_at: number;
}

async function loadTokens(): Promise<MALTokens> {
  const raw = await readFile(TOKENS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveTokens(tokens: MALTokens): Promise<void> {
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens();

  // Refresh if expired (with 5 min buffer)
  if (Date.now() / 1000 > tokens.expires_at - 300) {
    const res = await fetch("https://myanimelist.net/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: tokens.client_id,
        client_secret: tokens.client_secret,
      }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    tokens.access_token = data.access_token;
    tokens.refresh_token = data.refresh_token;
    tokens.expires_at = Math.floor(Date.now() / 1000) + data.expires_in;
    await saveTokens(tokens);
  }

  return tokens.access_token;
}

async function malApi(
  path: string,
  method: "GET" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, string>
): Promise<any> {
  const token = await getAccessToken();
  const url = `https://api.myanimelist.net/v2${path}`;

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  if (body && (method === "PUT" || method === "PATCH")) {
    options.headers = {
      ...options.headers,
      "Content-Type": "application/x-www-form-urlencoded",
    } as any;
    options.body = new URLSearchParams(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MAL API ${method} ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Search for an anime by name, returns top results.
 */
export async function searchAnime(
  query: string,
  limit: number = 5
): Promise<{ id: number; title: string; episodes: number; status: string }[]> {
  const data = await malApi(
    `/anime?q=${encodeURIComponent(query)}&limit=${limit}&fields=num_episodes,status`
  );
  return data.data.map((entry: any) => ({
    id: entry.node.mal_id || entry.node.id,
    title: entry.node.title,
    episodes: entry.node.num_episodes || 0,
    status: entry.node.status || "unknown",
  }));
}

/**
 * Update anime list status (add or update).
 */
export async function updateAnimeStatus(
  animeId: number,
  status: "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch",
  score?: number,
  numEpisodesWatched?: number
): Promise<string> {
  const body: Record<string, string> = { status };
  if (score !== undefined) body.score = score.toString();
  if (numEpisodesWatched !== undefined)
    body.num_watched_episodes = numEpisodesWatched.toString();

  const result = await malApi(`/anime/${animeId}/my_list_status`, "PUT", body);
  return `Updated: status=${result.status}, score=${result.score}, episodes=${result.num_episodes_watched}`;
}

/**
 * Delete anime from list.
 */
export async function removeAnime(animeId: number): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://api.myanimelist.net/v2/anime/${animeId}/my_list_status`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to remove anime: ${res.status}`);
  }
  return "Removed from list";
}

/**
 * Get user's anime list.
 */
export async function getMyAnimeList(
  status?: string,
  limit: number = 50
): Promise<{ title: string; score: number; status: string; episodes_watched: number }[]> {
  let path = `/users/@me/animelist?limit=${limit}&fields=list_status&sort=list_score`;
  if (status) path += `&status=${status}`;

  const data = await malApi(path);
  return data.data.map((entry: any) => ({
    title: entry.node.title,
    score: entry.list_status.score,
    status: entry.list_status.status,
    episodes_watched: entry.list_status.num_episodes_watched,
  }));
}

/**
 * Search for a manga by name, returns top results.
 */
export async function searchManga(
  query: string,
  limit: number = 5
): Promise<
  { id: number; title: string; chapters: number; volumes: number; status: string }[]
> {
  const data = await malApi(
    `/manga?q=${encodeURIComponent(query)}&limit=${limit}&fields=num_chapters,num_volumes,status`
  );
  return data.data.map((entry: any) => ({
    id: entry.node.mal_id || entry.node.id,
    title: entry.node.title,
    chapters: entry.node.num_chapters || 0,
    volumes: entry.node.num_volumes || 0,
    status: entry.node.status || "unknown",
  }));
}

/**
 * Update manga list status (add or update).
 */
export async function updateMangaStatus(
  mangaId: number,
  status: "reading" | "completed" | "on_hold" | "dropped" | "plan_to_read",
  score?: number,
  numChaptersRead?: number,
  numVolumesRead?: number
): Promise<string> {
  const body: Record<string, string> = { status };
  if (score !== undefined) body.score = score.toString();
  if (numChaptersRead !== undefined)
    body.num_chapters_read = numChaptersRead.toString();
  if (numVolumesRead !== undefined)
    body.num_volumes_read = numVolumesRead.toString();

  const result = await malApi(`/manga/${mangaId}/my_list_status`, "PUT", body);
  return `Updated: status=${result.status}, score=${result.score}, chapters=${result.num_chapters_read}, volumes=${result.num_volumes_read}`;
}

/**
 * Delete manga from list.
 */
export async function removeManga(mangaId: number): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://api.myanimelist.net/v2/manga/${mangaId}/my_list_status`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to remove manga: ${res.status}`);
  }
  return "Removed from list";
}

/**
 * Get user's manga list.
 */
export async function getMyMangaList(
  status?: string,
  limit: number = 50
): Promise<
  {
    title: string;
    score: number;
    status: string;
    chapters_read: number;
    volumes_read: number;
  }[]
> {
  let path = `/users/@me/mangalist?limit=${limit}&fields=list_status&sort=list_score`;
  if (status) path += `&status=${status}`;

  const data = await malApi(path);
  return data.data.map((entry: any) => ({
    title: entry.node.title,
    score: entry.list_status.score,
    status: entry.list_status.status,
    chapters_read: entry.list_status.num_chapters_read,
    volumes_read: entry.list_status.num_volumes_read,
  }));
}
