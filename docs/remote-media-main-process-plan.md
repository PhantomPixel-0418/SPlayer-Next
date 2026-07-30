# 远程媒体与 WebDAV 统一实施文档

## 1. 文档定位

本文是远程媒体主进程化和 WebDAV 接入的唯一设计、执行与接续文档。竞品实现细节参考
`docs/webdav-remote-list-analysis.md`，但实际架构以 SPlayer-Next 当前代码、数据模型和安全约束为准。

当前工作分支：`feat/media`。

当前分支以最新 `dev` 为基线，媒体功能提交线性位于 `dev` 之后。阶段 0 已完成，下一项工作从阶段 1A 开始。

## 2. 已完成基础

Subsonic、Jellyfin、Emby 已完成主进程化：

- 协议请求、鉴权、会话和实体转换位于 Electron 主进程；
- renderer 不持有密码、access token 或协议客户端；
- 凭据保存到 `streaming.json`，密码通过 Electron `safeStorage` 加密；
- 远程实体使用现有 `library.db`，没有第二个数据库；
- SQLite 使用 `remote_tracks`、`remote_albums`、`remote_artists`、`remote_playlists` 四张表；
- 数据库层直接存取完整 `Track/Album/Artist/Playlist`，不做协议转换；
- renderer Store 继续公开完整 `shallowRef` 数组，页面没有分页 UI；
- 封面使用 `streaming-cover://` 主进程代理；
- 播放地址经主进程解析后继续交给现有 Rust `HttpRangeSource`；
- 流媒体自身歌词、在线歌词、TTML、插件回退和预加载已经复用统一歌词链路；
- renderer 旧 Subsonic/Jellyfin/Emby 客户端与 IndexedDB `streaming-cache` 已删除。

当前相关结构：

```text
electron/main/services/streaming/
├── config.ts
├── connection.ts
├── coverProtocol.ts
├── library.ts
├── shadowSync.ts
└── adapters/
    ├── resolve.ts
    ├── subsonic.ts
    ├── jellyfin.ts
    └── types.ts

electron/main/database/remote-media/
├── tracks.ts
├── albums.ts
├── artists.ts
└── playlists.ts
```

已验证：

- Subsonic：歌曲、专辑、歌手与页面读取正常；
- Jellyfin：连接、同步、封面、播放、Range Seek、缓存下载和歌词正常；
- Emby：复用 Jellyfin adapter，仍需真实服务器回归；
- `pnpm typecheck`、相关 ESLint 和 Electron Vite 构建通过。

## 3. WebDAV 最终产品定义

WebDAV 是独立媒体来源，不伪装成本地文件，也不复用 `source: "streaming"`。

```ts
export type TrackSource = "local" | "webdav" | "streaming" | Platform;
```

来源语义：

| source      | 数据来源               | 元数据来源             | 播放解析       |
| ----------- | ---------------------- | ---------------------- | -------------- |
| `local`     | 本地目录               | 原生 FFmpeg 扫描器     | 本地路径       |
| `webdav`    | WebDAV 目录            | 原生 FFmpeg 远程 probe | 主进程鉴权代理 |
| `streaming` | Subsonic/Jellyfin/Emby | 服务端媒体 API         | adapter URL    |
| 在线平台    | 网易云、QQ、酷狗       | 平台 API               | 平台播放链路   |

WebDAV 仍显示在“媒体源”页面，与 Subsonic/Jellyfin/Emby 使用相同的服务器列表和媒体库页面结构，但通过独立类型控制播放、歌词、文件操作和元数据行为。

不可把 WebDAV 写入本地 `tracks` 表或 `library.scanDirs`：

- 本地 `tracks.path` 假定是真实文件系统路径；
- 本地扫描器使用 `WalkDir` 和 `fs::File`；
- 本地标签编辑、删除文件、CUE、外部歌词和文件夹操作都假定本地文件存在；
- WebDAV 断线不能被本地扫描器判断为文件删除。

WebDAV 继续使用远程媒体四张表，通过 `server_id + remote_id` 与其他服务器隔离。

## 4. 从竞品吸收与舍弃的设计

### 4.1 吸收

- `PROPFIND Depth: 1` 逐层枚举，不使用 `Depth: infinity`；
- 目录结果先转换为文件名 Track，让列表尽快可见；
- 元数据后台逐步补齐，不阻塞首批页面显示；
- 播放通过主进程本地代理附加 Authorization；
- 播放器的 Range 请求原样转发给 WebDAV；
- 同名外部歌词和同名/目录封面按需读取；
- 同一资源的请求进行并发去重；
- 所有内存 Map 必须有容量或生命周期边界。

### 4.2 不照搬

- 不以明文配置保存密码，继续使用 `safeStorage`；
- 不引入 `music-metadata` 形成第二套标签解析；
- 不把 WebDAV 仅建模成远程歌单，而是完整远程媒体库；
- 不开放删除、移动、复制、上传和标签写回；
- 不固定只扫描五层，深度由来源配置决定；
- 不顺序递归整个目录，使用有界并发广度优先队列；
- 不假设每个资源只有一个 `propstat`；
- 不把 URL、用户名或远程路径拼入 Track ID；
- 不在日志中输出 Authorization、密码或完整代理目标。

## 5. 类型与配置设计

### 5.1 服务器类型

在现有服务器类型中增加 `webdav`，同时让 WebDAV 配置成为可判别类型。

```ts
type CatalogServerType = Exclude<StreamingServerType, "webdav">;

interface BaseServerConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  hasPassword: boolean;
  lastConnected?: number;
}

interface CatalogServerConfig extends BaseServerConfig {
  type: CatalogServerType;
}

interface WebDavServerConfig extends BaseServerConfig {
  type: "webdav";
  rootPath: string;
  scanDepth: number;
}

type StreamingServerConfig = CatalogServerConfig | WebDavServerConfig;
```

`scanDepth` 语义：

- `0`：只扫描根目录；
- 正整数：继续扫描指定层数；
- `-1`：扫描全部子目录。

一个 WebDAV 媒体源只配置一个 `rootPath`。同一服务器的不同根目录需要作为不同媒体源添加，使名称、同步、删除索引和错误状态保持独立。

首版鉴权只支持：

- 无鉴权；
- Basic Auth，首次请求预发送 Authorization。

首版不支持 Digest、Bearer、OAuth、客户端证书和忽略 TLS 错误。测试服务器虽然在 401 中声明 Digest challenge，但已验证预发送 Basic 可以成功访问，因此 Basic 客户端不能等待 challenge 后才发送凭据。

### 5.2 Track

```ts
interface Track {
  source: "webdav";
  serverId: string;
  originalId: string;
  // 其余字段继续复用现有 Track
}
```

- `id`：`${serverId}:${remoteId}`，保持跨服务器唯一；
- `originalId`：规范化后的根目录相对路径；
- `path`：不设置，避免被识别为本地文件；
- `title`：probe 前使用无扩展名文件名，probe 后使用标签标题；
- `duration`：probe 前为 `0`，probe 后使用毫秒；
- `artists/album/quality/cover`：probe 后补齐。

`serverId/originalId` 的注释应从“仅 streaming”改为“远程媒体来源”，但不新增平行的 WebDAV ID 字段。

### 5.3 来源分支影响面

增加 `webdav` 不能只修改联合类型。实施阶段必须逐项审计现有 `source === "streaming"` 分支，按能力而不是按“是否远程”归类：

| 位置/能力                       | WebDAV 行为                                    |
| ------------------------------- | ---------------------------------------------- |
| `audioSource`、`downloadSource` | 进入 WebDAV 代理 URL 分支                      |
| 歌词 request/loader/resolve     | 先查 WebDAV 自身歌词，再复用统一在线解析       |
| queue 的服务器清理              | 按 `serverId` 同步清理，与 streaming 一致      |
| media 当前曲目详情              | 从远程媒体库加载，但不调用流媒体服务端详情接口 |
| collection、artist loader       | 查询现有远程媒体表                             |
| track 菜单、下载歌词            | 视为远程文件，不能落入网易云/QQ/酷狗平台分支   |
| Jellyfin/Emby session heartbeat | 不参与，WebDAV 没有播放会话协议                |
| UI 来源标签                     | 显示 `WEBDAV`，不显示 `STREAMING`              |

禁止用 `source !== "local" && source !== "streaming"` 判断在线平台；应显式使用平台类型判断函数。否则加入 `webdav` 后会误入平台 API。

## 6. 媒体源 UI

继续使用当前媒体源设置和媒体库页面，不新增另一套 WebDAV 页面或 Store。

WebDAV 表单字段：

- 名称；
- 类型：WebDAV；
- 服务地址；
- 用户名；
- 密码；
- 音乐目录；
- 扫描深度；
- 测试连接；
- 保存。

行为约束：

- 编辑时密码留空表示保留旧密码；
- HTTP 地址显示明文传输提醒，但允许用户保存；
- 保存后仍使用现有服务器卡片、切换、刷新和删除交互；
- 歌曲、专辑、歌手和文件夹保持完整数组，不增加分页 UI；
- WebDAV 没有服务端歌单，首版歌单数组为空；
- 删除媒体源只删除配置、代理映射和对应远程索引，不删除远端文件。

WebDAV 歌曲需要隐藏或禁用：

- 本地标签写入；
- 删除磁盘文件；
- 在资源管理器中打开；
- CUE 编辑或分轨；
- 任何 WebDAV 写操作。

## 7. WebDAV 客户端

新增：

```text
electron/main/services/streaming/webdav/
├── client.ts
├── parser.ts
├── paths.ts
├── scanner.ts
├── proxy.ts
└── metadata.ts
```

不把所有逻辑塞入一个 adapter 文件。

### 7.1 请求

`client.ts` 只负责：

- `PROPFIND`；
- `HEAD`；
- 带 Range 的 `GET`；
- Basic Auth；
- 同源重定向；
- 状态码和网络错误转换。

不实现 `PUT/DELETE/MOVE/COPY/MKCOL`。

所有请求使用主进程网络能力。Authorization 由运行时配置生成，不存入 Track、数据库或 renderer。

### 7.2 XML

使用 `fast-xml-parser`，但解析前拒绝 `DOCTYPE` 和 `ENTITY`，关闭实体处理并限制嵌套深度。

解析必须：

- 按 `DAV:` namespace 语义处理，不依赖 `ns0/d/a` 等前缀；
- 支持一个资源包含多个 `propstat`；
- 只合并状态为 200 的属性，不能因部分属性 404 丢弃资源；
- 支持绝对 URL、绝对路径和相对 href；
- 过滤 PROPFIND 返回的目录自身，不假设它永远是第一项；
- 支持中文、空格、`#`、`%` 和 Unicode；
- 拒绝 `..`、跨 origin、跨配置根目录和非法解码；
- 文件类型以扩展名为主，不能依赖 `Content-Type`。

本地测试服务已验证：

- WebDAV Class 1/2；
- `Depth: 0/1` 返回 207；
- XML 使用动态 `ns0` 前缀；
- 同一资源可能同时包含 200 和 404 `propstat`；
- 中文 href 使用 percent-encoding；
- 音频可能返回 `application/octet-stream`；
- HEAD 返回 `Accept-Ranges: bytes`；
- `Range: bytes=0-0` 返回 206 和有效 `Content-Range`。

## 8. 连接测试

测试连接顺序：

1. 规范化 URL 和 `rootPath`；
2. 对根目录执行 `PROPFIND Depth: 0`；
3. 不兼容时回退 `Depth: 1`；
4. 接受 200 或 207，并确认目标是 collection；
5. 使用 `Depth: 1` 查找首个支持的音频；
6. 对首个音频发送 `HEAD`；
7. 发送 `Range: bytes=0-0`；
8. 只有 206 且 `Content-Range` 有效才标记已验证播放能力。

目录为空时允许连接成功，但明确返回“目录可访问，尚未验证播放”。

错误归类：

- 401/403：`auth`；
- 404：路径错误；
- 405/501：协议不支持；
- TLS、DNS、连接拒绝、超时：`network`；
- XML 无效、href 越界、Range 响应非法：`protocol`。

## 9. 扫描与增量同步

WebDAV 不实现为普通 `StreamingAdapter.listSongs()` 分页循环。`shadowSync.ts` 按配置类型分发：目录型来源进入 WebDAV scanner，目录扫描完成后仍写入同一套远程表和通知事件。

扫描流程：

```text
读取旧 remote_id + etag + mtime + size
  → 队列加入 rootPath
  → PROPFIND Depth: 1
  → 规范化并校验 href
  → 子目录按 scanDepth 入队
  → 音频文件与旧索引比较
  → 未变化条目只刷新 generation
  → 新增/变化条目先写文件名 Track
  → 首批写入后通知 renderer
  → 后台原生 probe
  → 更新 Track 并聚合 Album/Artist
  → 全部目录成功后清理旧 generation
```

固定约束：

- 目录请求并发 4；
- 元数据 probe 并发 2；
- 同一服务器同时只有一个扫描任务；
- 新同步到来时取消旧任务并排队最新配置；
- 首批最多 100 首写入后通知 renderer；
- 后续每 100 首或每批 probe 完成后写入；
- 任一根目录扫描失败时保留旧 generation；
- 单文件 probe 失败不终止扫描；
- 只有完整成功才删除旧 generation；
- 强制刷新会重新 probe 失败条目，但不重复解析未变化成功条目。

需要在 `remote-media/tracks.ts` 增加面向同步的最小查询和更新函数：

- 读取指定 server 的 `remote_id/etag/mtime/size/data`；
- 批量刷新未变化记录的 generation；
- 批量更新 probe 后的 Track；

不增加 WebDAV 专用表，也不让数据库层解析 Track。

### 9.1 音频扩展名能力

项目当前存在两份不一致的扩展名列表：原生本地扫描器不含 `aiff`，云上传列表包含 `aiff`，本地测试 WebDAV 中还出现了 `dts`。WebDAV 不能再创建第三份列表。

实施前先建立共享的“可扫描音频扩展名”定义，由本地扫描、WebDAV 扫描和文件选择共同使用；最终是否纳入某扩展名，以 `ffmpeg_audio::AudioReader` 的实际探测结果为准，不仅凭文件后缀猜测。

- 基础集合：`mp3/flac/wav/m4a/aac/ogg/opus/wma/ape/aiff`；
- `dts` 必须用本地样本验证解封装、时长读取和播放，验证通过后纳入；
- 服务端返回未知后缀时不下载整文件试探，避免扫描流量失控；
- 文件名匹配大小写不敏感，URL 路径仍保持原始大小写。

## 10. 元数据策略

### 10.1 最终选择

不引入 `music-metadata`，继续使用当前原生 FFmpeg 解析器。

原因：

- 本地扫描器已经以 FFmpeg 产生标题、歌手、专辑、时长和音质；
- 现有 scanner 只打开容器和读取元数据，不会完整解码歌曲；
- FFmpeg 对 DTS、异常容器和多种无损格式兼容更好；
- 原生层已经实现标签归一化、准确时长、音质和 300px 封面；
- 避免本地和 WebDAV 两套解析器产生字段差异；
- 避免大封面进入 Node Buffer 和主进程 JS 堆。

竞品的渐进式 8–128 KiB `music-metadata` 读取只借鉴“先显示、后解析”的调度思想，不复制解析器。

### 10.2 原生重构

把 `scanner::probe_fast()` 中的公共逻辑提取为接受 `AudioReader` 的内部函数：

```rust
fn probe_reader(
    reader: AudioReader,
    identity: &str,
    cover_cache_dir: Option<&str>,
) -> Option<ScannedTrack>
```

本地：

```text
File → AudioReader → probe_reader
```

WebDAV：

```text
主进程临时代理 URL → HttpRangeSource → AudioReader → probe_reader
```

新增 NAPI：

```ts
probeRemoteTrack(url: string, identity: string): Promise<JsScannedTrack | null>
```

该入口：

- 不创建播放器；
- 不构建 resampler；
- 不进入解码循环；
- 不占用当前播放实例；
- 复用现有 `metadata::extract_tags/extract_stream_info/extract_cover_thumbnail`；
- 返回结构与本地扫描结果一致。

`identity` 使用稳定且随文件版本变化的值：

```text
webdav:{serverId}:{remoteId}:{etag-or-mtime-size}
```

这样封面缓存稳定，远端文件变化时会生成新缓存键。

### 10.3 失败回退

probe 失败时保留文件名 Track：

- `title`：无扩展名文件名；
- `artists`：空数组；
- `duration`：0；
- `fileSize/mtime`：使用 PROPFIND；
- `quality/cover/album`：空；
- 日志只记录 server 名称和相对路径摘要，不记录凭据。

播放成功后，现有 `player.load` 返回的 `mediaInfo` 可以补充当前会话信息，但不承担整库持久化。

## 11. 鉴权 Range 代理

不把用户名和密码写入 URL，不向 renderer 返回 Authorization，也不修改 Rust `HttpRangeSource` headers 接口。

新增主进程单例代理：

```text
electron/main/services/streaming/webdav/proxy.ts
```

数据链路：

```text
renderer 请求 serverId + remoteId
  → 主进程验证媒体源和路径
  → 创建短期随机代理 token
  → 返回 127.0.0.1 临时 HTTP URL
  → Rust HttpRangeSource 请求代理 URL
  → 代理附加 Basic Authorization
  → WebDAV 返回 206
```

代理要求：

- 只监听 `127.0.0.1` 随机端口；
- token 使用安全随机值，不编码 serverId、路径或密码；
- Map 最大 256 条，TTL 30 分钟；
- 相同 `serverId/remoteId/version` 可以复用有效 token；
- 支持 GET 和 HEAD；
- 仅转发 Range、If-Range、If-None-Match 等必要请求头；
- 原样返回 200/206/304/416 和必要响应头；
- 使用流式管道，不缓冲整首歌曲；
- 客户端断开时取消上游请求；
- 跨 origin 重定向时不转发 Authorization；
- 删除服务器或修改凭据时立即失效对应 token；
- 应用退出时关闭代理和上游流。

同一代理同时供播放、元数据 probe 和歌曲缓存下载使用，避免实现三套鉴权网络逻辑。

## 12. 专辑、歌手与文件夹

WebDAV 服务端不提供专辑和歌手实体。probe 后由主进程按标签聚合：

- Album ID：服务器 ID + 规范化专辑名；
- Artist ID：服务器 ID + 规范化歌手名；
- 无专辑或歌手的 Track 仍保留在歌曲列表；
- 聚合结果写入现有 `remote_albums/remote_artists`；
- 每次完整同步按 generation 删除失效聚合；
- WebDAV `remote_playlists` 为空。

文件夹视图使用 `relative_path` 构造树，不把 URL 或代理地址作为目录路径。

歌手字段继续遵循项目现有规则，不在 WebDAV 层擅自拆分服务端/标签给出的字符串；需要统一拆分时应修改公共元数据规则。

## 13. 封面

封面顺序：

1. 原生 probe 提取的内嵌封面；
2. 同名 `song.jpg/jpeg/png/webp`；
3. 同目录 `cover/folder/front.jpg/jpeg/png/webp`；
4. 默认封面。

目录枚举时记录可用 sidecar，不为每首歌曲额外发送多个 HEAD。内嵌封面继续由原生层生成 300px JPEG 到现有封面缓存。

- 列表、模糊背景、颜色提取使用 300px 缩略图；
- 当前播放的大封面按需读取；
- WebDAV sidecar 通过现有安全封面协议或等价受控 handler 获取；
- handler 只接受 `serverId + relativePath`，不能代理任意 URL；
- sidecar 和内嵌封面都按 ETag/version 失效。

## 14. 歌词

WebDAV 只提供“自身歌词”，在线歌词继续复用统一系统。

自身歌词顺序：

1. 同名 `.ttml`；
2. `.lys/.qrc/.krc/.yrc/.lrc/.ass/.srt`；
3. 播放加载后得到的内嵌歌词；
4. 无自身歌词。

扫描目录时记录同名歌词相对路径，播放时按需读取：

- 最大 2 MiB；
- 支持 BOM 和现有文本解码逻辑；
- 不把歌词正文写入 `remote_tracks`；
- 不增加 WebDAV 歌词缓存表。

来源偏好：

- `self`：只取 WebDAV sidecar/内嵌歌词；
- 指定平台：复用网易云、QQ、酷狗查询，失败时回退自身歌词；
- `auto`：自身歌词作为本地候选，继续使用现有格式优选、TTML 覆盖、插件回退和预加载。

在线匹配继续使用现有 `lyric_match_cache` 和 `lyric_cache`。指纹不包含 source/serverId，同一首本地、WebDAV 或流媒体歌曲共享匹配与歌词缓存。

## 15. 缓存与内存

持久数据：

- 媒体索引：现有 SQLite 远程媒体表；
- 在线歌词：现有歌词缓存表；
- 300px 封面：现有封面目录；
- 歌曲下载：现有歌曲缓存和下载任务。

内存状态：

- 每服务器一个扫描任务；
- 目录队列只保留尚未处理的路径；
- probe 并发 2；
- inflight 请求在完成后删除；
- 代理 token Map 最大 256、TTL 30 分钟；
- 不保存完整音频 Buffer；
- 不增加无上限目录、元数据或封面 Map。

renderer 仍只保存当前服务器完整 Track 数组，与已有媒体源一致；不再增加第二份 IndexedDB 快照。

## 16. 安全边界

- 密码只存在于 safeStorage 密文和主进程短期运行时对象；
- renderer、Track、SQLite、日志和代理 URL 不包含密码或 Authorization；
- XML 禁止 DTD、外部实体和超深嵌套；
- href 必须位于配置 origin 和 rootPath；
- URL 每一段独立编码，不能对整条路径重复 encode/decode；
- 拒绝 `..`、反斜杠绕过、scheme-relative URL 和跨 host href；
- 代理只绑定 loopback；
- 跨 origin 重定向丢弃 Authorization；
- 不提供关闭 TLS 验证的设置；
- HTTP 地址只提示风险，不静默升级或篡改；
- 首版所有 WebDAV 操作只读。

## 17. IPC 与 Store

继续扩展现有 `StreamingApi`，不新增 `WebDavApi` 或 `remoteMedia` 命名空间。

WebDAV 与现有服务器共用：

- `loadServers/addServer/updateServer/removeServer`；
- `testConnection/connect/disconnect`；
- `getSnapshot/sync/onLibraryUpdated`；
- `search/getAlbumSongs/getArtistSongs`；
- `getStreamUrl/getLyrics`。

renderer 根据 `track.source === "webdav"` 选择远程播放和自身歌词入口；协议、鉴权、路径和扫描细节全部留在主进程。

Store 继续公开：

```ts
songs: ShallowRef<Track[]>;
albums: ShallowRef<Album[]>;
artists: ShallowRef<Artist[]>;
playlists: ShallowRef<Playlist[]>;
```

不引入分页 UI，不把同步代次、目录队列或 probe 状态复制到 renderer。

## 18. 实施阶段

### 阶段 1A：类型、配置和连接

改动：

- 增加 `TrackSource: "webdav"` 和服务器可判别类型；
- 配置持久化支持 `rootPath/scanDepth`；
- 媒体源表单显示 WebDAV 字段；
- 实现安全 XML parser、路径模块和 WebDAV client；
- 使用本地测试服务器完成连接测试。

验收：

- 现有服务器配置兼容读取；
- renderer 看不到密码；
- `Depth: 0/1`、动态 namespace、多 propstat、中文 href 正常；
- Range 能力准确检测；
- 不写数据库、不影响现有媒体源。

### 阶段 1B：目录扫描和文件名快照

改动：

- 实现有界并发 BFS 和取消；
- 以文件名 Track 写入 `remote_tracks`；
- 增加未变化记录 generation 刷新；
- 构建 WebDAV 文件夹树所需 `relative_path`；
- 复用现有快照通知和完整数组 Store。

验收：

- 首批歌曲快速显示；
- 深度配置准确；
- 同路径不重复；
- 失败保留旧库，成功清理旧 generation；
- 搜索、播放全部和服务器切换行为不变。

### 阶段 1C：鉴权代理与播放

改动：

- 增加 loopback Range 代理；
- `getStreamUrl` 为 WebDAV 返回短期代理 URL；
- 接入现有播放、Seek、下一首预载和歌曲缓存。

验收：

- 凭据不进入 renderer；
- HEAD、GET、206、416 和取消正确；
- 已实测音频播放、Seek、停止和切歌；
- Subsonic/Jellyfin/Emby 播放链路无变化。

### 阶段 1D：原生远程 probe

改动：

- 提取 `probe_reader`；
- 新增 `probeRemoteTrack` NAPI；
- 主进程 probe 队列并发 2；
- 按 ETag 或 mtime+size 跳过未变化文件；
- 更新 Track 并聚合专辑、歌手。

验收：

- 本地扫描结果不变；
- WebDAV 标题、歌手、专辑、时长和音质与本地同文件一致；
- probe 不影响当前播放；
- 失败文件仍可显示和播放；
- 1 千、1 万首测试峰值内存可接受。

### 阶段 1E：封面、歌词和完整回归

改动：

- 内嵌与 sidecar 封面；
- 同名外部歌词；
- WebDAV 自身歌词接入统一歌词偏好；
- 删除媒体源时清理代理和索引；
- 完善 HTTP 风险提示和错误文案。

验收：

- 列表封面、全屏封面和系统媒体封面正常；
- `self/auto/指定平台` 歌词行为正确；
- 断网快照可浏览，恢复后可播放；
- 无密码/token 泄漏；
- 现有三类流媒体完整回归通过。

## 19. 测试矩阵

协议兼容：

- 本地 Cheroot WebDAV；
- AList；
- Nextcloud/ownCloud；
- Nginx WebDAV；
- 常见 NAS。

路径：

- 根目录 `/`；
- 中文、空格、`#`、`%`、括号和 Unicode；
- 绝对 URL/绝对路径 href；
- 当前目录项不在第一位；
- 多 `propstat`；
- 缺失 ETag、弱 ETag；
- 重复 slash、尾 slash 和错误 percent encoding。

扫描：

- 深度 0、有限深度、无限深度；
- 空目录；
- 1 千、1 万、5 万首；
- 扫描中取消、编辑服务器和删除服务器；
- 新增、修改、移动、删除远端文件；
- 目录失败、单文件 probe 失败和中途断网。

播放：

- MP3、FLAC、M4A、AAC、OGG、OPUS、WAV、APE、DTS；
- HEAD 和 Range；
- Seek、快速切歌、停止、缓存下载；
- 服务器返回 200 而非 206；
- 401、403、404、416 和连接中断。

元数据：

- 同一文件本地/WebDAV 字段一致；
- 大内嵌封面；
- 无标签、损坏标签和异常容器；
- 标签在文件尾部；
- ETag 变化后重新 probe；
- 未变化同步不重复 probe。

安全与内存：

- renderer、SQLite、日志和 URL 无 secret；
- XML DTD/ENTITY 被拒绝；
- href 不能越过 rootPath 或 origin；
- token 过期和容量淘汰；
- 客户端断开释放上游流；
- 隐藏窗口不接收新增高频事件。

## 20. 提交拆分

每个提交必须可构建、可验证、可单独回退：

1. `feat: 增加 WebDAV 媒体源配置`
2. `feat: 实现 WebDAV 连接与目录解析`
3. `feat: 增加 WebDAV 远程媒体扫描`
4. `feat: 增加 WebDAV 鉴权播放代理`
5. `feat: 增加 WebDAV 原生元数据探测`
6. `feat: 完善 WebDAV 封面与歌词`

不在同一个提交中同时重写现有 Subsonic/Jellyfin/Emby 播放链路。

## 21. 下一项实际任务

从阶段 1A 开始：

1. 修改 `TrackSource` 和服务器配置可判别类型；
2. 给媒体源表单增加 WebDAV、根目录和扫描深度；
3. 新建 `webdav/client.ts`、`parser.ts`、`paths.ts`；
4. 只实现连接测试，不写数据库、不接播放；
5. 使用已启动的本地 WebDAV 验证 Basic、207、多 propstat、中文 href 和 Range；
6. 通过类型检查、相关 ESLint 和完整构建；
7. 更新本文档“已完成基础”和阶段状态后再进入 1B。

开始前检查 `git status`，保留用户已有文档和代码改动。任何新实现都必须补齐中文 JSDoc，并保持现有前端完整数组和无分页 UI 契约。
