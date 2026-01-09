import { fetchText } from "../utils/http.js";

export type FeedEntry = {
  video_id: string;
  published_at: string;
  source_url: string;
  channel_id: string;
};

type FetchOptions = {
  timeoutMs?: number;
  retries?: number;
};

const ENTRY_REGEX = /<entry>([\s\S]*?)<\/entry>/g;
const VIDEO_ID_REGEX = /<yt:videoId>([^<]+)<\/yt:videoId>/;
const PUBLISHED_REGEX = /<published>([^<]+)<\/published>/;
const LINK_REGEX = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*\/?>/;

function parseEntry(entryXml: string, channelId: string): FeedEntry | null {
  const videoId = entryXml.match(VIDEO_ID_REGEX)?.[1]?.trim();
  const published = entryXml.match(PUBLISHED_REGEX)?.[1]?.trim();
  if (!videoId || !published) {
    return null;
  }

  const link = entryXml.match(LINK_REGEX)?.[1]?.trim();
  const sourceUrl = link ?? `https://www.youtube.com/watch?v=${videoId}`;

  return {
    video_id: videoId,
    published_at: published,
    source_url: sourceUrl,
    channel_id: channelId
  };
}

export async function fetchChannelFeed(
  channelId: string,
  options: FetchOptions = {}
): Promise<FeedEntry[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const xml = await fetchText(url, {
    timeoutMs: options.timeoutMs ?? 10_000,
    retries: options.retries ?? 2,
    baseDelayMs: 500
  });

  const entries: FeedEntry[] = [];
  for (const match of xml.matchAll(ENTRY_REGEX)) {
    const entryXml = match[1];
    if (!entryXml) {
      continue;
    }
    const parsed = parseEntry(entryXml, channelId);
    if (parsed) {
      entries.push(parsed);
    }
  }

  return entries;
}
