import path from "node:path";
import { defaultCacheDir } from "@main/utils/paths";
import { mediaLog } from "@main/utils/logger";
import { getActiveAiModel } from "@main/services/ai/model";
import { createLyricEnhancementService } from "./lyricEnhancementService";

const service = createLyricEnhancementService({
  cacheDir: path.join(defaultCacheDir, "lyric-enhancement"),
  getActiveAiModel,
  fetch,
  log: mediaLog,
});

export const enhanceLyrics = service.enhanceLyrics;
export const clearLyricEnhancementCache = service.clearLyricEnhancementCache;
