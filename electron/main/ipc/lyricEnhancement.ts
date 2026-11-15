import { ipcMain } from "electron";
import type { LyricEnhancementRequest } from "@shared/types/lyricEnhancement";
import { enhanceLyrics, clearLyricEnhancementCache } from "@main/services/lyricEnhancement";

/** 注册歌词展示增强接口 */
export const registerLyricEnhancementIpc = (): void => {
  ipcMain.handle("lyricEnhancement:enhance", (_event, request: LyricEnhancementRequest) =>
    enhanceLyrics(request),
  );
  ipcMain.handle("lyricEnhancement:clearCache", clearLyricEnhancementCache);
};
