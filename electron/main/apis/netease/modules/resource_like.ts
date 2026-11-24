/**
 * 点赞 / 取消点赞资源（MV、视频等）
 *
 * params:
 * - threadId  资源线程 id，如 R_MV_5_{mvid} / R_VI_62_{vid}
 * - t         1 点赞，0 取消点赞
 *
 * 响应：`{ code, ... }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const resource_like: NeteaseModule = (query, request) => {
  const action = String(query.t) === "1" ? "like" : "unlike";
  const data = { threadId: query.threadId };
  return request(`/api/resource/${action}`, data, createOption(query, "weapi"));
};

export default resource_like;
