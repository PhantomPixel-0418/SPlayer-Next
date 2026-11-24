import type { CoverItem } from "@/types/artist";
import type { VideoItem } from "@/types/video";

/**
 * 视频 → 通用封面卡片数据
 * @param video - 视频条目
 * @returns 可交给 CoverList 渲染的封面卡片
 */
export const videoToCoverItem = (video: VideoItem): CoverItem => ({
  id: video.id,
  title: video.title,
  cover: video.cover,
  subtitle: video.artists.map((artist) => artist.name).join(" / "),
  trackCount: 0,
  playCount: video.playCount,
  duration: video.duration,
  videoKind: video.kind,
});
