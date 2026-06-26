import { supabase } from "./supabase.ts";

export type Visibility = "private" | "public";
export type FeedStatus = "pending" | "approved" | "rejected";

export type Feed = {
  id: number;
  owner_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  author_name: string | null;
  channels: string[];
  tags: string[];
  visibility: Visibility;
  status: FeedStatus;
  official: boolean;
  by_admin: boolean;
  reject_reason: string | null;
  created_at: string;
  owner?: { display_name: string | null; username: string | null } | null;
};

export function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

export type Media =
  | { type: "photo"; url: string }
  | { type: "video"; url?: string; thumb?: string }
  | { type: "roundvideo"; url?: string; thumb?: string }
  | { type: "voice"; url?: string }
  | { type: "sticker"; url: string }
  | { type: "document"; title: string; extra?: string }
  | { type: "link"; href?: string; site?: string; title?: string; description?: string; image?: string };

export type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  media: Media[];
  link: string;
  views?: string;
  channelTitle?: string;
  channelAvatar?: string;
};

function db() {
  return supabase();
}

// ---- Ленты текущего пользователя ----
export async function myFeeds(): Promise<Feed[]> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) return [];
  const { data, error } = await db()
    .from("feeds")
    .select("*")
    .eq("owner_id", u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Feed[]) ?? [];
}

// ---- Одобренные публичные ленты (доступны без входа) ----
export async function publicFeeds(): Promise<Feed[]> {
  const { data, error } = await db()
    .from("feeds")
    .select("*, owner:profiles(display_name, username)")
    .eq("visibility", "public")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Feed[]) ?? [];
}

export async function getFeedById(id: number): Promise<Feed | null> {
  const { data, error } = await db()
    .from("feeds")
    .select("*, owner:profiles(display_name, username)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Feed) ?? null;
}

export type FeedInput = {
  title: string;
  description?: string | null;
  cover_url?: string | null;
  author_name?: string | null;
  channels?: string[];
  visibility: Visibility;
  tags?: string[];
  official?: boolean;
  by_admin?: boolean;
};

export async function createFeed(input: FeedInput): Promise<Feed> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) throw new Error("нужен вход");
  const { data, error } = await db()
    .from("feeds")
    .insert({
      owner_id: u.user.id,
      title: input.title.trim(),
      description: input.description?.slice(0, 300) || null,
      cover_url: input.cover_url || null,
      author_name: input.author_name?.trim() || null,
      channels: input.channels ?? [],
      visibility: input.visibility,
      tags: cleanTags(input.tags),
      official: !!input.official,
      by_admin: !!input.by_admin,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Feed;
}

export async function updateFeed(
  id: number,
  fields: Partial<Pick<Feed, "title" | "description" | "cover_url" | "author_name" | "channels" | "visibility" | "tags" | "official" | "by_admin">>,
): Promise<void> {
  const patch: Record<string, unknown> = { ...fields };
  if (patch.tags) patch.tags = cleanTags(patch.tags as string[]);
  if (typeof patch.description === "string") patch.description = (patch.description as string).slice(0, 300) || null;
  const { error } = await db().from("feeds").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// Загрузка обложки в Supabase Storage (bucket "covers"), возвращает публичный URL.
export async function uploadCover(file: File): Promise<string> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) throw new Error("нужен вход");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${u.user.id}/${Date.now()}.${ext}`;
  const { error } = await db().storage.from("covers").upload(path, file, { upsert: true });
  if (error) throw new Error(error.message);
  return db().storage.from("covers").getPublicUrl(path).data.publicUrl;
}

// Админ: пометить/снять «официальный источник».
export async function setOfficial(id: number, value: boolean): Promise<void> {
  const { error } = await db().from("feeds").update({ official: value }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFeed(id: number): Promise<void> {
  const { error } = await db().from("feeds").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- Модерация (только админ; RLS/триггеры на сервере это гарантируют) ----
export async function pendingFeeds(): Promise<Feed[]> {
  const { data, error } = await db()
    .from("feeds")
    .select("*, owner:profiles(display_name, username)")
    .eq("visibility", "public")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Feed[]) ?? [];
}

export async function moderateFeed(
  id: number,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const { error } = await db()
    .from("feeds")
    .update({ status: decision, reject_reason: reason ?? null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- Чтение каналов через серверную edge-функцию ----
export async function readChannels(
  channels: string[],
): Promise<{ posts: Post[]; unavailable: string[] }> {
  if (channels.length === 0) return { posts: [], unavailable: [] };
  const { data, error } = await db().functions.invoke("read-channels", {
    body: { channels },
  });
  if (error) throw new Error(error.message);
  return data as { posts: Post[]; unavailable: string[] };
}
