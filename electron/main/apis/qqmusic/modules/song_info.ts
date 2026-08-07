/**
 * 单曲详情
 * module: music.pf_song_detail_svr / get_song_detail_yqq
 *
 * params:
 * - mid  songmid，例如 "001qvvgF38HVc4"
 */

import { qmRequest } from "../core/request";
import { formatSingerName, decodeName } from "../core/config";
import type { QMModule } from "../core/types";

interface TrackInfo {
  id: number;
  mid: string;
  title: string;
  interval: number;
  singer?: Array<{ name?: string; mid?: string }>;
  album?: { name?: string; mid?: string };
  file?: Record<string, number | string>;
}

const songInfo: QMModule = async (params) => {
  const { mid } = params;

  const data = await qmRequest<{ track_info?: TrackInfo }>(
    "music.pf_song_detail_svr",
    "get_song_detail_yqq",
    { song_type: 0, song_mid: mid },
  );

  const track = data?.track_info;
  if (!track) return { code: 404, message: "song not found" };

  return {
    code: 200,
    song: {
      id: String(track.id),
      mid: track.mid,
      name: decodeName(track.title),
      artist: formatSingerName(track.singer),
      album: decodeName(track.album?.name),
      albumMid: track.album?.mid ?? "",
      duration: (track.interval ?? 0) * 1000,
      file: track.file,
    },
  };
};

export default songInfo;
