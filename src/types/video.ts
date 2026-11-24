import type { MusicCommentItem } from "@shared/types/comment";

/** 视频类型：MV / 云村视频 */
export type VideoKind = "mv" | "video";

/** 视频歌手/作者 */
export interface VideoArtist {
  /** 歌手 id */
  id: string;
  /** 歌手名 */
  name: string;
  /** 头像 */
  avatar?: string;
}

/** 视频卡片摘要 */
export interface VideoItem {
  /** 视频 id */
  id: string;
  /** 视频类型 */
  kind: VideoKind;
  /** 标题 */
  title: string;
  /** 封面 */
  cover?: string;
  /** 播放量 */
  playCount: number;
  /** 时长（毫秒） */
  duration: number;
  /** 歌手 */
  artists: VideoArtist[];
}

/** 清晰度档位 */
export interface VideoQuality {
  /** 清晰度（1080 / 720 / 480 / 240） */
  br: number;
  /** 文件大小（字节） */
  size?: number;
}

/** 视频详情 */
export interface VideoDetail extends VideoItem {
  /** 简介 */
  description?: string;
  /** 标签 */
  tags: string[];
  /** 发布时间戳（毫秒）或日期字符串 */
  publishTime?: string | number;
  /** 评论数 */
  commentCount: number;
  /** 分享数 */
  shareCount: number;
  /** 点赞数 */
  likedCount: number;
  /** 收藏数 */
  subCount: number;
  /** 是否已点赞 */
  liked: boolean;
  /** 是否已收藏 */
  subscribed: boolean;
  /** 可用清晰度，按 br 降序 */
  qualities: VideoQuality[];
}

/** 视频播放源 */
export interface VideoSource {
  /** 播放地址 */
  url: string;
  /** 清晰度 */
  quality: number;
  /** 文件大小（字节） */
  size?: number;
}

/** 视频评论分页 */
export interface VideoCommentPage {
  /** 评论列表 */
  list: MusicCommentItem[];
  /** 评论总数（热门分类为热门评论数） */
  total: number;
  /** 是否还有下一页 */
  hasMore: boolean;
}
