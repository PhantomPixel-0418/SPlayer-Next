/**
 * 视频评论
 *
 * params:
 * - id      视频 id
 * - limit   每页数量，默认 20
 * - offset  偏移
 * - before  超过 5000 条后的时间游标
 *
 * 响应：`{ code, comments, hotComments, total, more, hasMore }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const comment_video: NeteaseModule = (query, request) => {
  const data = {
    rid: query.id,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    beforeTime: query.before ?? 0,
  };
  return request(
    `/api/v1/resource/comments/R_VI_62_${query.id}`,
    data,
    createOption(query, "weapi"),
  );
};

export default comment_video;
