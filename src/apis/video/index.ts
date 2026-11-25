/**
 * MV / 视频接口
 *
 * 网易云接口原始响应 → 应用层 VideoItem / VideoDetail；
 * 视频子系统当前仅支持 netease 音源。
 */

import type { MusicCommentItem } from "@shared/types/comment";
import type {
  VideoCommentPage,
  VideoDetail,
  VideoItem,
  VideoKind,
  VideoQuality,
  VideoSource,
} from "@/types/video";
import type { SearchResult } from "@/apis/search";
import { netease } from "@/apis/netease";
import { withPicSize } from "@/utils/format/netease";

interface RawArtist {
  id?: number | string;
  name?: string;
  img1v1Url?: string;
  picUrl?: string;
}

interface RawVideo {
  id?: number | string;
  vid?: number | string;
  name?: string;
  title?: string;
  cover?: string;
  coverUrl?: string;
  picUrl?: string;
  /** /artist/mvs 的封面字段 */
  imgurl?: string;
  imgurl16v9?: string;
  playCount?: number;
  /** /video/detail 的播放量 */
  playTime?: number;
  duration?: number;
  durationms?: number;
  artists?: RawArtist[];
  /** /artist/mvs 返回单个 artist */
  artist?: RawArtist;
  artistId?: number | string;
  artistName?: string;
  creator?: { userId?: number | string; nickname?: string; avatarUrl?: string };
}

/** 原始视频条目 → 应用层 VideoItem */
const toVideoItem = (raw: RawVideo, kind: VideoKind): VideoItem => {
  const artistList = (raw.artists ?? [])
    .filter((artist) => artist.name?.trim())
    .map((artist) => ({
      id: String(artist.id ?? ""),
      name: artist.name!.trim(),
      avatar: withPicSize(artist.img1v1Url ?? artist.picUrl),
    }));
  if (!artistList.length && raw.artist?.name?.trim()) {
    artistList.push({
      id: String(raw.artist.id ?? ""),
      name: raw.artist.name.trim(),
      avatar: withPicSize(raw.artist.img1v1Url ?? raw.artist.picUrl),
    });
  }
  if (!artistList.length && (raw.artistName || raw.creator?.nickname)) {
    artistList.push({
      id: String(raw.artistId ?? raw.creator?.userId ?? ""),
      name: (raw.artistName ?? raw.creator?.nickname)!,
      avatar: withPicSize(raw.creator?.avatarUrl),
    });
  }
  return {
    id: String(raw.id ?? raw.vid ?? ""),
    kind,
    title: raw.name ?? raw.title ?? "",
    cover: withPicSize(raw.cover ?? raw.coverUrl ?? raw.picUrl ?? raw.imgurl ?? raw.imgurl16v9),
    playCount: Number(raw.playCount ?? raw.playTime ?? 0),
    duration: Number(raw.duration ?? raw.durationms ?? 0),
    artists: artistList,
  };
};

/** 校验网易云响应 code */
const ensureOk = <T>(body: T): T => {
  const meta = body as { code?: number; message?: string; msg?: string } | null | undefined;
  if (!meta || meta.code !== 200) {
    const detail = meta?.code == null ? "unknown" : String(meta.code);
    throw new Error(meta?.message ?? meta?.msg ?? `接口返回异常（code=${detail}）`);
  }
  return body;
};

/**
 * 视频详情
 * @param kind - 视频类型
 * @param id - 视频 id
 * @returns 合并互动数据后的视频详情
 */
export const getVideoDetail = async (kind: VideoKind, id: string): Promise<VideoDetail> => {
  const detailPromise =
    kind === "mv" ? netease.mv_detail({ mvid: id }) : netease.video_detail({ id });
  const infoPromise =
    kind === "mv" ? netease.mv_detail_info({ mvid: id }) : netease.video_detail_info({ vid: id });
  const [detailBody, infoBody] = await Promise.all([detailPromise, infoPromise]);
  ensureOk(detailBody);
  /** subed 返回在响应顶层，合并进 data */
  const raw = {
    ...(detailBody?.data ?? {}),
    subed: detailBody?.subed,
  } as RawVideo & {
    desc?: string;
    description?: string;
    briefDesc?: string;
    publishTime?: string | number;
    subCount?: number;
    /** /video/detail 的收藏数 */
    subscribeCount?: number;
    shareCount?: number;
    commentCount?: number;
    likeCount?: number;
    /** /video/detail 的点赞数 */
    praisedCount?: number;
    liked?: boolean;
    subed?: boolean;
    subscribed?: boolean;
    brs?: { br?: number; size?: number }[];
    resolutions?: { resolution?: number; size?: number }[];
    tags?: string[];
    videoGroup?: { name?: string }[];
  };
  const info = (infoBody ?? {}) as {
    likedCount?: number;
    commentCount?: number;
    shareCount?: number;
    liked?: boolean;
  };
  const qualities: VideoQuality[] = ((kind === "mv" ? raw.brs : raw.resolutions) ?? [])
    .map((item) => ({
      br: Number(kind === "mv" ? item.br : (item as { resolution?: number }).resolution) || 0,
      size: item.size,
    }))
    .filter((item) => item.br > 0)
    .sort((a, b) => b.br - a.br);
  return {
    ...toVideoItem(raw, kind),
    description: raw.desc ?? raw.description ?? raw.briefDesc,
    tags: raw.tags ?? (raw.videoGroup ?? []).map((tag) => tag.name ?? "").filter(Boolean),
    publishTime: raw.publishTime,
    commentCount: Number(info.commentCount ?? raw.commentCount ?? 0),
    shareCount: Number(info.shareCount ?? raw.shareCount ?? 0),
    likedCount: Number(info.likedCount ?? raw.likeCount ?? raw.praisedCount ?? 0),
    subCount: Number(raw.subCount ?? raw.subscribeCount ?? 0),
    liked: Boolean(info.liked ?? raw.liked),
    subscribed: Boolean(raw.subed ?? raw.subscribed),
    qualities,
  };
};

/**
 * 批量获取视频播放地址
 * @param kind - 视频类型
 * @param id - 视频 id
 * @param qualities - 清晰度列表
 * @returns 可用播放源
 */
export const getVideoSources = async (
  kind: VideoKind,
  id: string,
  qualities: number[],
): Promise<VideoSource[]> => {
  const requests = qualities.map(async (quality) => {
    try {
      const body =
        kind === "mv"
          ? await netease.mv_url({ id, r: quality })
          : await netease.video_url({ id, res: quality });
      const raw = (kind === "mv" ? body?.data : (body?.urls?.[0] ?? body?.data?.[0])) as
        { url?: string; r?: number; size?: number } | undefined;
      if (!raw?.url) return null;
      const source: VideoSource = {
        url: raw.url.replace(/^http:/, "https:"),
        quality: Number(raw.r ?? quality),
      };
      if (raw.size != null) source.size = raw.size;
      return source;
    } catch {
      return null;
    }
  });
  const sources = await Promise.all(requests);
  return sources.filter((source): source is VideoSource => source !== null);
};

/**
 * 相关推荐视频
 * @param kind - 视频类型
 * @param id - 视频 id
 * @param artistId - 可选歌手 id，提供时优先返回同歌手 MV（比 simi_mv 更相关，后者接口未个性化时恒定返回同一组访谈）
 * @returns 相关视频列表
 */
export const getRelatedVideos = async (
  kind: VideoKind,
  id: string,
  artistId?: string,
): Promise<VideoItem[]> => {
  try {
    if (kind === "mv" && artistId && artistId !== "0") {
      const body = await netease.artist_mv({ id: artistId, offset: 0, limit: 12 });
      const items = (body?.mvs ?? [])
        .map((raw: RawVideo) => toVideoItem(raw, "mv"))
        .filter((item: VideoItem) => item.id !== id);
      if (items.length) return items;
    }
    if (kind === "mv") {
      const body = await netease.simi_mv({ mvid: id });
      const items = (body?.mvs ?? [])
        .map((raw: RawVideo) => toVideoItem(raw, "mv"))
        .filter((item: VideoItem) => item.id !== id);
      if (items.length) return items;
    }
    const body = await netease.related_allvideo({ id });
    const list = (body?.data ?? []) as (RawVideo & { type?: number })[];
    return list
      .map((raw) => toVideoItem(raw, raw.type === 1 ? "video" : kind))
      .filter((item) => item.id !== id);
  } catch {
    return [];
  }
};

/**
 * 推荐 MV（首页）
 * @returns 推荐 MV 列表
 */
export const getRecommendedMvs = async (): Promise<VideoItem[]> => {
  const body = await netease.personalized_mv();
  const items = (body?.result ?? []).map((raw: RawVideo) => toVideoItem(raw, "mv"));
  if (items.length) return items;
  /** 游客态推荐结果为空时回退到全站 MV */
  const all = await netease.mv_all({
    area: "全部",
    type: "全部",
    order: "上升最快",
    limit: 20,
    offset: 0,
  });
  return (all?.data ?? []).map((raw: RawVideo) => toVideoItem(raw, "mv"));
};

/**
 * 歌手相关 MV
 * @param artistId - 歌手 id
 * @param offset - 偏移
 * @param limit - 数量
 * @returns 分页结果
 */
export const getArtistVideos = async (
  artistId: string,
  offset: number,
  limit: number,
): Promise<SearchResult<VideoItem>> => {
  const body = await netease.artist_mv({ id: artistId, offset, limit });
  const items = (body?.mvs ?? []).map((raw: RawVideo) => toVideoItem(raw, "mv"));
  return { items, total: Number(body?.total ?? offset + items.length), hasMore: !!body?.hasMore };
};

/**
 * 已收藏 MV 列表
 * @param offset - 偏移
 * @param limit - 数量
 * @returns 分页结果
 */
export const getSubscribedMvs = async (
  offset: number,
  limit: number,
): Promise<SearchResult<VideoItem>> => {
  const body = await netease.mv_sublist({ offset, limit });
  const items = (body?.data ?? []).map((raw: RawVideo) => toVideoItem(raw, "mv"));
  return {
    items,
    total: Number(body?.count ?? offset + items.length),
    hasMore: !!body?.hasMore,
  };
};

/**
 * 全量拉取已收藏 MV
 * @returns 收藏的 MV 列表
 */
export const fetchAllSubscribedMvs = async (): Promise<VideoItem[]> => {
  const limit = 50;
  const items: VideoItem[] = [];
  for (;;) {
    const page = await getSubscribedMvs(items.length, limit);
    items.push(...page.items);
    if (!page.hasMore || !page.items.length) break;
  }
  return items;
};

/**
 * 搜索 MV
 * @param keyword - 关键词
 * @param offset - 偏移
 * @param limit - 数量
 * @returns 分页结果
 */
export const searchVideos = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<VideoItem>> => {
  const body = await netease.cloudsearch({ keywords: keyword, type: 1004, offset, limit });
  const mvs = (body?.result?.mvs ?? []) as RawVideo[];
  const items = mvs.map((raw) => toVideoItem(raw, "mv"));
  const total = Number(body?.result?.mvCount ?? items.length);
  return { items, total, hasMore: offset + items.length < total };
};

/**
 * 收藏 / 取消收藏视频
 * @param kind - 视频类型
 * @param id - 视频 id
 * @param subscribed - 目标收藏状态
 */
export const setVideoSubscribed = async (
  kind: VideoKind,
  id: string,
  subscribed: boolean,
): Promise<void> => {
  const body =
    kind === "mv"
      ? await netease.mv_sub({ mvid: id, t: subscribed ? 1 : 0 })
      : await netease.video_sub({ id, t: subscribed ? 1 : 0 });
  ensureOk(body);
};

/**
 * 点赞 / 取消点赞视频
 * @param kind - 视频类型
 * @param id - 视频 id
 * @param liked - 目标点赞状态
 */
export const setVideoLiked = async (kind: VideoKind, id: string, liked: boolean): Promise<void> => {
  const threadId = kind === "mv" ? `R_MV_5_${id}` : `R_VI_62_${id}`;
  const body = await netease.resource_like({ threadId, t: liked ? 1 : 0 });
  ensureOk(body);
};

/** 原始评论 → 应用层评论 */
const toComment = (raw: any): MusicCommentItem => ({
  id: String(raw.commentId ?? raw.id ?? ""),
  userId: raw.user?.userId != null ? String(raw.user.userId) : undefined,
  userName: raw.user?.nickname ?? "",
  avatar: withPicSize(raw.user?.avatarUrl),
  text: raw.content ?? "",
  time: raw.time,
  location: raw.ipLocation?.location ?? raw.location,
  likedCount: raw.likedCount,
});

/**
 * 视频评论
 * @param kind - 视频类型
 * @param id - 视频 id
 * @param offset - 偏移
 * @param limit - 数量
 * @param hot - 是否加载热门评论
 * @returns 评论分页
 */
export const getVideoComments = async (
  kind: VideoKind,
  id: string,
  offset: number,
  limit: number,
  hot: boolean,
): Promise<VideoCommentPage> => {
  /** 热门评论走 hotcomments 接口：total 为热门评论数，且支持 offset 翻页 */
  const body = hot
    ? await netease.comment_hot({
        id,
        type: kind === "mv" ? "R_MV_5_" : "R_VI_62_",
        offset,
        limit,
      })
    : kind === "mv"
      ? await netease.comment_mv({ id, offset, limit })
      : await netease.comment_video({ id, offset, limit });
  const rawList = (hot ? body?.hotComments : body?.comments) ?? [];
  const list = rawList.map(toComment);
  const total = Number(body?.total ?? 0);
  return {
    list,
    total,
    hasMore: offset + list.length < total,
  };
};
