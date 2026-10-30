import { ipcMain } from "electron";
import type { LyricEnhancementRequest } from "@shared/types/lyricEnhancement";
import { enhanceLyrics, clearLyricEnhancementCache } from "@main/services/lyricEnhancement";
import {
  getLyricDictionaryStatus,
  downloadLyricDictionary,
  removeLyricDictionary,
} from "@main/services/lyricDictionary";

/** 注册歌词展示增强与离线词典管理接口 */
export const registerLyricEnhancementIpc = (): void => {
  ipcMain.handle("lyricEnhancement:enhance", (_event, request: LyricEnhancementRequest) =>
    enhanceLyrics(request),
  );
  ipcMain.handle("lyricEnhancement:dictionaryStatus", getLyricDictionaryStatus);
  ipcMain.handle("lyricEnhancement:downloadDictionary", downloadLyricDictionary);
  ipcMain.handle("lyricEnhancement:removeDictionary", removeLyricDictionary);
  ipcMain.handle("lyricEnhancement:clearCache", clearLyricEnhancementCache);
};
