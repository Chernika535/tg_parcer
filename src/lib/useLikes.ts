import { useCallback, useEffect, useState } from "react";
import { likeLinks, addLike, removeLike, type Post } from "./data.ts";

// Локальные лайки постов: множество лайкнутых ссылок + переключатель.
export function useLikes(enabled: boolean) {
  const [liked, setLiked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (enabled) likeLinks().then((l) => setLiked(new Set(l))).catch(() => {});
  }, [enabled]);
  const toggle = useCallback((post: Post) => {
    setLiked((prev) => {
      const next = new Set(prev);
      if (next.has(post.link)) { next.delete(post.link); removeLike(post.link); }
      else { next.add(post.link); addLike(post); }
      return next;
    });
  }, []);
  return { liked, toggle };
}
