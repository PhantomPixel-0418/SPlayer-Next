/**
 * QM API 通用常量
 */

import he from "he";

/** 统一接口入口（移动端 musicu） */
export const QM_API_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";

/** 模拟移动端的默认 headers */
export const QM_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.14.9",
  Referer: "https://y.qq.com",
  Cookie: "tmeLoginType=-1;",
};

/** 请求体 comm 字段（伪装 Android 客户端） */
export const getCommonParams = (): Record<string, string | number> => ({
  ct: 11,
  cv: "1003006",
  v: "1003006",
  os_ver: "15",
  phonetype: "24122RKC7C",
  tmeAppID: "qqmusiclight",
  nettype: "NETWORK_WIFI",
  udid: "0",
  OpenUDID: "0",
  QIMEI36: "0",
  uin: "0",
});

/** Session 缓存时长（毫秒） */
export const SESSION_TTL = 60 * 60 * 1000;

/** 歌手数组格式化工具：`[{name:'A'},{name:'B'}]` → `A / B` */
export const formatSingerName = (
  singers: Array<{ name?: string; title?: string }> | undefined,
  key: "name" | "title" = "name",
  join = " / ",
): string => {
  if (!singers?.length) return "";
  return singers
    .map((item) => decodeName(item[key]))
    .filter((item): item is string => !!item)
    .join(join);
};

/**
 * HTML 实体反转义（he 库通用解码，支持所有命名实体和数字实体）
 */
export const decodeName = (str: string | null | undefined): string => {
  if (!str) return "";
  return he.decode(str);
};
