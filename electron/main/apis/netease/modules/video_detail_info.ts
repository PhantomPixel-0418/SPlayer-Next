/**
 * 视频点赞 / 评论 / 分享数
 *
 * params:
 * - vid  视频 id
 *
 * 响应：`{ code, likedCount, commentCount, shareCount, ... }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const video_detail_info: NeteaseModule = (query, request) => {
  const data = {
    threadid: `R_VI_62_${query.vid}`,
    composeliked: true,
  };
  return request("/api/comment/commentthread/info", data, createOption(query, "weapi"));
};

export default video_detail_info;
