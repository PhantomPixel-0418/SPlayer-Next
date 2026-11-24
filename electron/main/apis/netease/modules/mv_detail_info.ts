/**
 * MV 点赞 / 评论 / 分享数
 *
 * params:
 * - mvid  MV id
 *
 * 响应：`{ code, likedCount, commentCount, shareCount, ... }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mv_detail_info: NeteaseModule = (query, request) => {
  const data = {
    threadid: `R_MV_5_${query.mvid}`,
    composeliked: true,
  };
  return request("/api/comment/commentthread/info", data, createOption(query, "weapi"));
};

export default mv_detail_info;
