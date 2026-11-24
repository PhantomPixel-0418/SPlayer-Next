/** 注册业务模块，供公共请求入口按名称路由 */

import type { NeteaseModule } from "../core/types";

import captcha_sent from "./captcha_sent";
import captcha_verify from "./captcha_verify";
import login from "./login";
import login_cellphone from "./login_cellphone";
import login_qr_check from "./login_qr_check";
import login_qr_create from "./login_qr_create";
import login_qr_key from "./login_qr_key";
import login_refresh from "./login_refresh";
import login_status from "./login_status";
import logout from "./logout";
import register_anonimous from "./register_anonimous";

import user_account from "./user_account";
import user_cloud from "./user_cloud";
import user_cloud_del from "./user_cloud_del";
import cloud_upload_check from "./cloud_upload_check";
import cloud_nos_token from "./cloud_nos_token";
import cloud_upload_info from "./cloud_upload_info";
import cloud_pub from "./cloud_pub";
import cloud_upload_check_v2 from "./cloud_upload_check_v2";
import cloud_song_import from "./cloud_song_import";
import user_detail from "./user_detail";
import user_detail_new from "./user_detail_new";
import user_followeds from "./user_followeds";
import user_follows from "./user_follows";
import user_level from "./user_level";
import user_playlist from "./user_playlist";
import user_record from "./user_record";
import record_recent_song from "./record_recent_song";
import user_subcount from "./user_subcount";
import deviceinfo_center_upload from "./deviceinfo_center_upload";

import cloudsearch from "./cloudsearch";
import search from "./search";
import search_default from "./search_default";
import search_match from "./search_match";
import search_multimatch from "./search_multimatch";
import search_suggest from "./search_suggest";
import search_suggest_pc from "./search_suggest_pc";
import audio_match from "./audio_match";

import lyric from "./lyric";
import lyric_new from "./lyric_new";
import cloud_lyric_get from "./cloud_lyric_get";

import comment_music from "./comment_music";
import comment_hot from "./comment_hot";

import song_detail from "./song_detail";
import song_url from "./song_url";
import song_download_url from "./song_download_url";
import song_simi_get from "./song_simi_get";
import song_wiki_info from "./song_wiki_info";
import song_dynamic_cover from "./song_dynamic_cover";
import playmode_intelligence from "./playmode_intelligence";
import personal_fm from "./personal_fm";
import fm_trash from "./fm_trash";
import scrobble from "./scrobble";
import scrobble_v1 from "./scrobble_v1";

import recommend_songs from "./recommend_songs";
import personalized from "./personalized";
import recommend_resource from "./recommend_resource";
import top_artists from "./top_artists";
import album_new from "./album_new";

import playlist_detail from "./playlist_detail";
import playlist_create from "./playlist_create";
import playlist_delete from "./playlist_delete";
import playlist_tracks from "./playlist_tracks";
import playlist_subscribe from "./playlist_subscribe";
import playlist_name_update from "./playlist_name_update";
import playlist_desc_update from "./playlist_desc_update";
import playlist_order_update from "./playlist_order_update";
import likelist from "./likelist";
import like from "./like";
import like_v1 from "./like_v1";
import song_like from "./song_like";

import album from "./album";
import album_sub from "./album_sub";

import artists from "./artists";
import artist_album from "./artist_album";
import artist_songs from "./artist_songs";

import album_sublist from "./album_sublist";
import artist_sub from "./artist_sub";
import artist_sublist from "./artist_sublist";

import mv_detail from "./mv_detail";
import mv_url from "./mv_url";
import mv_detail_info from "./mv_detail_info";
import mv_sub from "./mv_sub";
import mv_sublist from "./mv_sublist";
import mv_all from "./mv_all";
import artist_mv from "./artist_mv";
import personalized_mv from "./personalized_mv";
import simi_mv from "./simi_mv";
import related_allvideo from "./related_allvideo";
import video_detail from "./video_detail";
import video_url from "./video_url";
import video_detail_info from "./video_detail_info";
import video_sub from "./video_sub";
import comment_mv from "./comment_mv";
import comment_video from "./comment_video";
import resource_like from "./resource_like";

export const modules: Record<string, NeteaseModule> = {
  captcha_sent,
  captcha_verify,
  login,
  login_cellphone,
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_refresh,
  login_status,
  logout,
  register_anonimous,

  user_account,
  user_cloud,
  user_cloud_del,
  cloud_upload_check,
  cloud_nos_token,
  cloud_upload_info,
  cloud_pub,
  cloud_upload_check_v2,
  cloud_song_import,
  user_detail,
  user_detail_new,
  user_followeds,
  user_follows,
  user_level,
  user_playlist,
  user_record,
  record_recent_song,
  user_subcount,
  deviceinfo_center_upload,

  cloudsearch,
  search,
  search_default,
  search_match,
  search_multimatch,
  search_suggest,
  search_suggest_pc,
  audio_match,

  lyric,
  lyric_new,
  cloud_lyric_get,

  comment_music,
  comment_hot,

  song_detail,
  song_url,
  song_url_v1: song_url,
  song_download_url,
  song_simi_get,
  song_wiki_info,
  song_dynamic_cover,
  playmode_intelligence,
  personal_fm,
  personal_fm_mode: personal_fm,
  fm_trash,
  scrobble,
  scrobble_v1,

  recommend_songs,
  personalized,
  recommend_resource,
  top_artists,
  album_new,

  playlist_detail,
  playlist_create,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  playlist_name_update,
  playlist_desc_update,
  playlist_order_update,
  likelist,
  like,
  like_v1,
  song_like,

  album,
  album_sub,

  artists,
  artist_album,
  artist_songs,

  album_sublist,
  artist_sub,
  artist_sublist,

  mv_detail,
  mv_url,
  mv_detail_info,
  mv_sub,
  mv_sublist,
  mv_all,
  artist_mv,
  personalized_mv,
  simi_mv,
  related_allvideo,
  video_detail,
  video_url,
  video_detail_info,
  video_sub,
  comment_mv,
  comment_video,
  resource_like,
};
