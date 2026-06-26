import { supabase } from "./supabase.ts";

export type Visibility = "private" | "public";
export type FeedStatus = "pending" | "approved" | "rejected";

export type Feed = {
  id: number;
  owner_id: string;
  title: string;
  channels: string[];
  visibility: Visibility;
  status: FeedStatus;
  reject_reason: string | null;
  created_at: string;
  owner?: { display_name: string | null; username: string | null } | null;
};

export type Post = {
  channel: string;
  msgId: number;
  postedAt: string;
  text: string;
  hasMedia: boolean;
  link: string;
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

export async function createFeed(input: {
  title: string;
  channels?: string[];
  visibility: Visibility;
}): Promise<Feed> {
  const { data: u } = await db().auth.getUser();
  if (!u.user) throw new Error("нужен вход");
  const { data, error } = await db()
    .from("feeds")
    .insert({
      owner_id: u.user.id,
      title: input.title.trim(),
      channels: input.channels ?? [],
      visibility: input.visibility,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Feed;
}

export async function updateFeed(
  id: number,
  fields: Partial<Pick<Feed, "title" | "channels" | "visibility">>,
): Promise<void> {
  const { error } = await db().from("feeds").update(fields).eq("id", id);
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
