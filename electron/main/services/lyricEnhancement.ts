import path from "node:path";
import { defaultCacheDir } from "@main/utils/paths";
import { getActiveAiModel } from "@main/services/ai/model";
import { optimizeWithJapaneseDictionary } from "@main/services/lyricDictionary";
import { createLyricEnhancementService } from "./lyricEnhancementService";

const service = createLyricEnhancementService({
  cacheDir: path.join(defaultCacheDir, "lyric-enhancement"),
  getActiveAiModel,
  optimizeWithJapaneseDictionary,
  fetch,
});

export const enhanceLyrics = service.enhanceLyrics;
export const clearLyricEnhancementCache = service.clearLyricEnhancementCache;
