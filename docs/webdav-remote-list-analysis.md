# any-listen WebDAV 远程列表实现方案全面分析

## 目录

1. [整体架构](#1-整体架构)
2. [WebDAV 认证机制](#2-webdav-认证机制)
3. [目录读取与遍历](#3-目录读取与遍历)
4. [音乐元信息读取策略](#4-音乐元信息读取策略)
5. [封面图片获取策略](#5-封面图片获取策略)
6. [歌词获取策略](#6-歌词获取策略)
7. [延迟解析（Lazy Parse）机制](#7-延迟解析lazy-parse机制)
8. [UI 显示与懒加载](#8-ui-显示与懒加载)
9. [缓存机制](#9-缓存机制)
10. [代理服务器机制](#10-代理服务器机制)

---

## 1. 整体架构

### 1.1 分层结构

```
┌─────────────────────────────────────────────────────────────────┐
│  View Layer (Svelte)                                            │
│  ├── RemoteListForm.svelte  ── 新建/编辑远程列表表单              │
│  ├── ListItem.svelte        ── 歌曲列表项（懒加载封面）            │
│  └── MusicList/List         ── 歌曲列表容器                      │
├─────────────────────────────────────────────────────────────────┤
│  Music Library Module (view-main)                               │
│  ├── store/commit.ts        ── 状态变更（listMusicAdd等）         │
│  ├── store/event.ts         ── 事件系统（listMusicUpdated等）     │
│  └── store/listRemoteActions.ts ── 远程列表操作                   │
├─────────────────────────────────────────────────────────────────┤
│  Shared App Module                                              │
│  ├── extension/remoteListProvider.ts ── 远程列表提供者管理         │
│  ├── musicList/index.ts             ── 列表操作入口               │
│  └── musicList/localListProvider.ts  ── 本地列表提供者            │
├─────────────────────────────────────────────────────────────────┤
│  Extension Service (Worker)                                     │
│  ├── webdav/index.ts        ── 扩展注册（manifest + setup）       │
│  ├── webdav/listProviderAction.ts ── 列表操作实现                 │
│  ├── webdav/resourceAction.ts     ── 资源操作（URL/封面/歌词）     │
│  ├── webdav/webdav.ts       ── WebDAV 核心逻辑                   │
│  └── webdav/utils.ts        ── 工具函数（密码管理/验证）           │
├─────────────────────────────────────────────────────────────────┤
│  Node.js Layer                                                  │
│  ├── nodejs/webdav-client/index.ts ── WebDAV HTTP 客户端          │
│  ├── nodejs/music.ts               ── 音频元数据解析              │
│  └── nodejs/request.ts             ── HTTP 请求封装（undici）     │
├─────────────────────────────────────────────────────────────────┤
│  Proxy Server Module                                            │
│  └── proxyServer/index.ts   ── 代理服务器（URL代理/缓存）          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 WebDAV 扩展注册

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/index.ts`

```typescript
export const pkg: AnyListen.Extension.Manifest = {
  id: "internal.webdav",
  name: "WebDAV",
  version: "0.0.1",
  contributes: {
    // 扩展设置项
    settings: [
      { field: "enabledCache", name: "缓存", type: "boolean", default: false },
      { field: "enabledDebugLog", name: "调试日志", type: "boolean", default: false },
      { field: "servers", name: "服务器列表", type: "input", textarea: true, default: "" },
    ],
    // 列表提供者定义
    listProviders: [
      {
        id: "webdav",
        name: "WebDAV",
        fileSortable: true,
        form: [
          { field: "url", type: "input" }, // 服务器地址
          { field: "username", type: "input" }, // 用户名
          { field: "directory", type: "input" }, // 目录路径
          { field: "includeSubDir", type: "boolean" }, // 包含子目录
          { field: "enabledRemove", type: "boolean" }, // 允许删除
          { type: "lazzyParseMeta", default: false }, // 延迟解析元数据
        ],
      },
    ],
    // 资源提供者定义
    resource: [
      {
        id: "webdav",
        resource: ["musicUrl", "musicPic", "musicLyric"],
      },
    ],
  },
};
```

---

## 2. WebDAV 认证机制

### 2.1 认证方式

**文件**: `packages/shared/nodejs/webdav-client/index.ts:86-93`

使用 **HTTP Basic Authentication**：

```typescript
constructor(options: WebDAVClientOptions) {
  this.options = options
  this.baseUrl = options.baseUrl.replace(/\/$/, '')
  if (options.username) {
    // 将 username:password 进行 Base64 编码
    const token = Buffer.from(`${options.username}:${options.password || ''}`).toString('base64')
    this.authHeader = `Basic ${token}`
  }
}
```

### 2.2 请求时注入认证头

**文件**: `packages/shared/nodejs/webdav-client/index.ts:132-137`

```typescript
private async request<T = unknown>(
  method: Options['method'],
  { path, ...options }: Omit<Options, 'method'> & { path?: string } = {}
) {
  const headers = options.headers || {}
  if (this.authHeader) headers.Authorization = this.authHeader  // 自动注入
  const url = this.getFullUrl(path)
  // ...发起请求
}
```

### 2.3 密码管理

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/utils.ts`

密码存储在扩展配置的 `servers` 字段中，格式为：

```
url1, username1, password1
url2, username2, password2
```

```typescript
// 获取密码
const getPassword = async (url: string, username: string) => {
  const servers = await getServers();
  return (
    servers.find((server) => server.url === url && server.username === username)?.password || ""
  );
};

// 保存密码
export const savePassword = async (url: string, username: string, password: string) => {
  const servers = await getServers();
  const server = servers.find((server) => server.url === url && server.username === username);
  if (server) {
    server.password = password;
  } else {
    servers.push({ url, username, password });
  }
  await saveServers(servers);
};
```

### 2.4 认证失败处理

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:37-46`

```typescript
export const buildWebDAVError = (options: WebDAVClientOptions, err: Error) => {
  const msg = err.message;
  if (msg.startsWith("401")) {
    if (!options.password) {
      return Error("请输入密码"); // 无密码
    }
    return Error("密码错误"); // 密码错误
  }
  return err;
};
```

### 2.5 密码输入流程

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:48-78`

```typescript
export const setPassword = async (options: WebDAVClientOptions) => {
  // 弹出输入框让用户输入密码
  const password = await hostContext.showInputBox({
    placeholder: "请输入密码",
    title: options.password ? "密码错误，请重新输入" : "请输入密码",
    // 验证函数：尝试用输入的密码连接
    async validateInput(value) {
      const webDAVClient = createWebDAVClient({ ...options, password: value });
      return webDAVClient
        .ls(options.path)
        .then(() => null) // 验证成功
        .catch(async (err: Error) => {
          if (err.message.startsWith("401")) {
            return "密码错误"; // 验证失败
          }
          return null; // 其他错误不阻断
        });
    },
  });
  // 保存密码到配置
  await savePassword(options.url, options.username, password);
  options.password = password;
};
```

### 2.6 目录测试（testDir）

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:80-96`

创建或更新列表时会调用 `testDir` 验证连接：

```typescript
export const testDir = async (options: WebDAVClientOptions) => {
  const webDAVClient = createWebDAVClient(options);
  await webDAVClient.ls(options.path).catch(async (err: Error) => {
    if (err.message.startsWith("401")) {
      // 401 错误：尝试让用户输入密码
      if ((await setPassword(options).catch(() => 1)) !== 1) {
        await sleep(500);
        return testDir(options); // 递归重试
      }
      throw Error("密码错误或未提供");
    }
    throw buildWebDAVError(options, err);
  });
};
```

---

## 3. 目录读取与遍历

### 3.1 WebDAV PROPFIND 请求

**文件**: `packages/shared/nodejs/webdav-client/index.ts:189-204`

使用 WebDAV 的 `PROPFIND` 方法读取目录：

```typescript
async ls(path = '/'): Promise<WebDAVItem[]> {
  if (!path.startsWith('/')) path = `/${path}`
  // Depth: '1' 表示只读取当前目录的直接子项
  const res = await this.request<Ls>('PROPFIND', { headers: { Depth: '1' }, path })

  const currentFullPath = this.getFullUrl(path)
  // 过滤掉当前目录本身（WebDAV PROPFIND 会返回目录自身）
  const responses = res.multistatus.response.filter((item) => {
    const isDir = item.propstat.prop.resourcetype?.collection === ''
    if (!isDir) return true
    const href = item.href.endsWith('/') ? item.href.slice(0, -1) : item.href
    return !currentFullPath.endsWith(href)
  })
  return buildFileItems(responses, path == '/' ? '' : path)
}
```

### 3.2 解析 WebDAV 响应

**文件**: `packages/shared/nodejs/webdav-client/index.ts:35-75`

WebDAV 返回 XML 格式，使用 `fast-xml-parser` 解析：

```typescript
const buildFileItems = (list: LsResp[], path: string): WebDAVItem[] => {
  return list.map((item) => {
    // 判断是否为目录：resourcetype 中有 collection 属性
    const isDir = item.propstat.prop.resourcetype?.collection === "";
    // 解码 URL 编码的文件名
    let rawName = item.href.endsWith("/") ? item.href.slice(0, -1) : item.href;
    rawName = rawName.substring(rawName.lastIndexOf("/") + 1);
    const name = decodeURIComponent(rawName);

    return isDir
      ? {
          path: `${path}/${rawName}`,
          isDir: true,
          name,
          lastModified: new Date(item.propstat.prop.getlastmodified).getTime(),
          creationDate: 0,
        }
      : {
          path: `${path}/${rawName}`,
          name,
          isDir: false,
          lastModified: new Date(item.propstat.prop.getlastmodified).getTime(),
          creationDate: 0,
          contentType: item.propstat.prop.getcontenttype,
          size: parseInt(item.propstat.prop.getcontentlength),
        };
  });
};
```

### 3.3 递归遍历子目录

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/listProviderAction.ts:55-105`

```typescript
const MAX_DEEP = 5; // 最大递归深度

const getDirFiles = async (opts, deep = 0): Promise<WebDAVItemWithId[]> => {
  const buildMusicIds = async (list: WebDAVItem[]) => {
    const dirs: string[] = [];
    let items: WebDAVItemWithId[] = [];

    for (const item of list) {
      if (item.isDir) {
        // 如果启用了子目录且未超过最大深度，记录子目录
        if (opts.isIncludeDir && deep < MAX_DEEP) dirs.push(item.path);
      } else if (item.size > 0 && isMusicFile(item.name)) {
        // 只处理音乐文件（通过扩展名判断）
        const path = generateId(opts.extId, opts.source, opts.webDAVClientOptions, item);
        musicCache.set(path, item);
        items.push({ ...item, id: path });
      }
    }

    // 递归处理子目录
    if (dirs.length) {
      for (const dir of dirs) {
        const subItems = await getDirFiles({ ...opts, path: dir }, deep + 1);
        items = items.concat(subItems);
      }
    }
    return items;
  };

  // 使用缓存或重新请求
  const list =
    opts.useCache && listCache.has(opts.path)
      ? listCache.get(opts.path)!
      : await opts.webDAVClient.ls(opts.path).then((list) => {
          listCache.set(opts.path, list);
          return list;
        });

  return buildMusicIds(list);
};
```

### 3.4 音乐文件过滤

**文件**: `packages/shared/nodejs/music.ts:203-206`

```typescript
const musicExtensions = MEDIA_FILE_TYPES.map((ext) => `.${ext}`);
export const isMusicFile = (filePath: string): boolean => {
  return musicExtensions.includes(extname(filePath));
};
```

### 3.5 文件 ID 生成

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/listProviderAction.ts:47-49`

```typescript
const generateId = (
  extId: string,
  source: string,
  options: WebDAVClientOptions,
  item: WebDAVItem,
) => {
  // 组合扩展ID、源、用户名、URL、文件路径生成唯一ID
  return `${extId}_${source}_${options.username}_${options.url}_${item.path}`;
};
```

---

## 4. 音乐元信息读取策略

### 4.1 渐进式读取策略

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:98-159`

元信息读取采用**渐进式**策略，从文件头部开始逐步读取更多数据：

```typescript
// 读取长度映射表：从小到大逐步增加
const nextLenMap = {
  0: 8 * 1024, // 第一次读 8KB
  [8 * 1024]: 16 * 1024, // 第二次读到 16KB
  [16 * 1024]: 32 * 1024, // 第三次读到 32KB
  [32 * 1024]: 64 * 1024, // 第四次读到 64KB
  [64 * 1024]: 96 * 1024,
  [96 * 1024]: 128 * 1024,
  [128 * 1024]: 192 * 1024,
  [192 * 1024]: 256 * 1024,
};
const MAX_META_LENGTH = 128 * 1024; // 元信息模式最大读取 128KB

const requestParseMetadata = async ({
  webDAVClient,
  path,
  mimeType,
  isMetaOnly,
  needCache,
  data,
  preLength,
  ext,
}) => {
  // 检查缓存
  if (cache.has(path)) return cache.get(path)!;

  // 计算下次读取长度
  let nextLength = nextLenMap[preLength];
  if (!nextLength || (isMetaOnly && nextLength > MAX_META_LENGTH)) return null;

  // 使用 Range 请求读取文件的一部分
  data = Buffer.concat([data, await webDAVClient.getPartial(path, preLength, nextLength - 1)]);

  // 尝试解析元数据
  const metaHead = await parseBufferMetadata(data, mimeType, ext).catch(() => null);
  if (!metaHead) return null;

  // 如果解析出了关键信息（歌名、歌手、专辑），返回结果
  if (metaHead.name || metaHead.singer || metaHead.albumName) {
    if (needCache) cache.set(path, metaHead);
    return metaHead;
  }

  // 否则继续读取更多数据
  return requestParseMetadata({
    webDAVClient,
    path,
    mimeType,
    isMetaOnly,
    needCache,
    data,
    preLength: nextLength,
  });
};
```

### 4.2 完整元信息解析

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:161-188`

```typescript
export const parseMusicMetadata = async (options, path, fileSize?, ext) => {
  const webDAVClient = createWebDAVClient(options);
  const mimeType = getMimeType(basename(path));

  // 先尝试从文件头部解析
  const metaHead = await handleParseMetadata({ webDAVClient, path, mimeType, isMetaOnly: true });
  if (metaHead?.name || metaHead?.singer || metaHead?.albumName) return metaHead;

  // 如果头部没解析出，获取文件大小
  if (!fileSize) {
    const headers = await webDAVClient.getHead(path);
    fileSize = parseInt(headers["content-length"] || "0", 10);
  }

  // 尝试从文件尾部读取（某些格式的元数据在尾部）
  const data = await webDAVClient.getPartial(path, fileSize - 32 * 1024); // 最后 32KB
  const metaTail = await parseBufferMetadata(data, mimeType, ext).catch(() => null);
  if (metaTail?.name || metaTail?.singer || metaTail?.albumName) return metaTail;

  return null;
};
```

### 4.3 音频元数据解析

**文件**: `packages/shared/nodejs/music.ts:81-104`

使用 `music-metadata` 库解析音频文件：

```typescript
export const parseBufferMetadata = async (buffer: Buffer, mimeType: string, ext: string) => {
  const { parseBuffer, selectCover } = await import("music-metadata");
  const metadata = await parseBuffer(buffer, mimeType, { skipPostHeaders: true, duration: false });

  let name = (metadata.common.title || "").trim();
  const isLikelyNameGarbage = isLikelyGarbage(name);
  if (isLikelyNameGarbage) name = "";
  let singer = isLikelyNameGarbage ? "" : getArtist(ext, metadata);
  let albumName = isLikelyNameGarbage ? "" : (metadata.common.album?.trim() ?? "");
  let interval =
    metadata.format.duration && metadata.format.duration > 2
      ? formatPlayTime(metadata.format.duration)
      : null;

  return {
    name, // 歌曲名
    singer, // 歌手
    interval, // 时长
    albumName, // 专辑名
    bitrateLabel: bitrateFormat(metadata.format), // 比特率
    year: metadata.common.year ?? 0, // 年份
    trackNo: metadata.common.track.no, // 音轨号
    discNo: metadata.common.disk.no, // 碟片号
    pic: selectCover(metadata.common.picture) || null, // 封面图片
    lyric: getMetadataLyric(metadata), // 内嵌歌词
  };
};
```

---

## 5. 封面图片获取策略

### 5.1 三级查找策略

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:228-247`

```typescript
export const getMusicPic = async (options, path) => {
  const webDAVClient = createWebDAVClient(options);

  // 第一级：查找同名图片文件（如 song.mp3 -> song.jpg）
  let pic = await getDirNamePic(webDAVClient, path);
  if (pic) return pic;

  // 第二级：从文件内嵌元数据中提取封面
  const mimeType = getMimeType(basename(path));
  const metaHead = await handleParseMetadata({
    webDAVClient,
    path,
    mimeType,
    isMetaOnly: false,
    needCache: true,
  });
  if (metaHead?.pic) {
    const filePath = new RegExp(`\\${extnameRaw(path)}$`);
    const [type, ext] = metaHead.pic.format.split("/");
    if (type == "image") {
      // 将内嵌图片写入代理缓存
      const [url] = webDAVClient.getRequestOptions(path.replace(filePath, `.${ext}`));
      return hostContext.writeProxyCache(url, metaHead.pic.data);
    }
  }

  // 第三级：查找目录下的 cover.jpg/cover.png
  pic = await getDirCoverPic(webDAVClient, path);
  if (pic) return pic;

  throw new Error("get pic failed");
};
```

### 5.2 同名图片查找

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:207-227`

```typescript
const tryPicExt = [".jpg", ".jpeg", ".png"] as const;

const getDirNamePic = async (webDAVClient, path) => {
  const filePath = new RegExp(`\\${extnameRaw(path)}$`);
  // 尝试 song.mp3 -> song.jpg, song.jpeg, song.png
  for await (const ext of tryPicExt) {
    const picPath = path.replace(filePath, ext);
    const [url, reqOpts] = webDAVClient.getRequestOptions(picPath);
    const picUrl = await hostContext
      .createProxyUrl(url, reqOpts, await getEnabledCache())
      .catch(() => null);
    if (picUrl) return picPath;
  }
  return null;
};
```

---

## 6. 歌词获取策略

### 6.1 两级查找策略

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:249-262`

```typescript
export const getMusicLyric = async (options, path) => {
  const webDAVClient = createWebDAVClient(options);

  // 第一级：查找同名 .lrc 文件（如 song.mp3 -> song.lrc）
  const lrcPath = path.replace(new RegExp(`\\${extnameRaw(path)}$`), ".lrc");
  const data = await webDAVClient.get(lrcPath).catch(() => null);
  if (data) {
    const lrc = await decodeString(data);
    if (lrc && !isLikelyGarbage(lrc)) return lrc;
  }

  // 第二级：从文件内嵌元数据中提取歌词
  const mimeType = getMimeType(basename(path));
  const metaHead = await handleParseMetadata({
    webDAVClient,
    path,
    mimeType,
    isMetaOnly: false,
    needCache: true,
  });
  return metaHead?.lyric || null;
};
```

---

## 7. 延迟解析（Lazy Parse）机制

### 7.1 设计理念

延迟解析是本项目的核心优化策略。当用户创建远程列表时，如果启用了 `lazzyParseMeta` 选项：

1. **快速显示列表**：只读取文件名和大小，立即显示列表
2. **异步解析元数据**：后台逐步解析歌曲的歌手、专辑等信息
3. **按需更新 UI**：解析完成后通过事件系统更新界面

### 7.2 列表同步流程

**文件**: `packages/shared/app/modules/extension/remoteListProvider.ts:120-185`

```typescript
export const syncList = async (list: AnyListen.List.RemoteListInfo) => {
  // 并行获取本地数据库的歌曲和远程服务器的歌曲ID
  const [musics, ids] = await Promise.all([
    workers.dbService.getListMusics(list.id),
    workers.extensionService.listProviderAction("getListMusicIds", {
      /* ... */
    }),
  ]);

  // 计算差异
  const remoteIds = new Set(ids);
  const newMusicIds = new Set<string>(); // 新增的歌曲
  const removedMusicIds = new Set<string>(); // 删除的歌曲
  // ...差异计算逻辑

  // 获取新歌曲的基础信息
  const { musics: newMusics, waitingParseMetadata } = newMusicIds.size
    ? await workers.extensionService.listProviderAction("getMusicInfoByIds", {
        /* ... */
      })
    : { musics: [], waitingParseMetadata: false };

  // 删除已移除的歌曲
  if (removedMusicIds.size) {
    await sendMusicListAction({ action: "list_music_remove" /* ... */ });
  }

  // 添加新歌曲
  if (newMusics.length) {
    await sendMusicListAction({ action: "list_music_add" /* ... */ });

    // 关键：如果没有启用延迟解析，立即批量解析元数据
    if (waitingParseMetadata && list.meta.lazzyParseMeta !== true) {
      await handleMusicsParseBatch(list.meta.extensionId, list.meta.source, list.id, newMusics);
    }
  }

  // 如果没有启用延迟解析，解析所有未解析的歌曲
  if (list.meta.lazzyParseMeta !== true) {
    const unparsedMusics = musics.filter((m) => m.meta.unparsed);
    if (!unparsedMusics.length) return;
    await handleMusicsParseBatch(list.meta.extensionId, list.meta.source, list.id, unparsedMusics);
  }
};
```

### 7.3 快速返回歌曲信息（不解析元数据）

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/listProviderAction.ts:241-301`

```typescript
async getMusicInfoByIds({ data }) {
  const options = await getWebDAVOptionsByListInfo(data.list.meta)
  // 先确保目录已扫描并缓存
  await getListMusicIds(/* ... */)

  return {
    musics: data.ids
      .map((id) => {
        const item = musicCache.get(id)
        if (!item) return null
        const lastDotIndex = item.name.lastIndexOf('.')
        return {
          id,
          // 只用文件名作为歌曲名，去掉扩展名
          name: item.name.substring(0, lastDotIndex) || item.name,
          singer: '',           // 歌手为空
          isLocal: false,
          interval: null,       // 时长为空
          meta: {
            ext: item.name.substring(lastDotIndex + 1).toLowerCase(),
            unparsed: true,     // 标记为未解析
            // ...其他基础信息
          },
        }
      })
      .filter((m) => m != null),
    waitingParseMetadata: true,  // 标记需要后续解析
  }
}
```

### 7.4 批量解析元数据

**文件**: `packages/shared/app/modules/extension/remoteListProvider.ts:94-112`

```typescript
const handleMusicsParseBatch = async (extId, source, listId, list, index = -1) => {
  // 每次解析 10 首歌曲
  const musics = list.slice(index + 1, index + 11);
  let musicInfos = await handleMusicsParse(extId, source, musics);

  if (musicInfos.length) {
    // 更新数据库和 UI
    await updateMusicBaseInfo(listId, musicInfos);
  }

  index += 10;
  // 继续解析下一批
  if (list.length - 1 > index) {
    musicInfos = [
      ...musicInfos,
      ...(await handleMusicsParseBatch(extId, source, listId, list, index)),
    ];
  }
  return musicInfos;
};
```

### 7.5 单首歌曲元数据解析

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/listProviderAction.ts:302-323`

```typescript
async parseMusicInfoMetadata({ data: musicInfo }) {
  const options = await getWebDAVOptionsByMusicInfo(musicInfo)
  const meta = await parseMusicMetadata(options, options.path, musicInfo.meta.size)

  if (!meta) return { ...musicInfo, meta: { ...musicInfo.meta, unparsed: false } }

  return {
    ...musicInfo,
    name: meta.name || musicInfo.name,      // 更新歌名
    singer: meta.singer || musicInfo.singer, // 更新歌手
    interval: meta.interval || musicInfo.interval,
    meta: {
      ...musicInfo.meta,
      unparsed: false,  // 标记为已解析
      albumName: meta.albumName || '',
      year: meta.year || 0,
      trackNo: meta.trackNo || null,
      discNo: meta.discNo || null,
      bitrateLabel: meta.bitrateLabel || '',
    },
  }
}
```

---

## 8. UI 显示与懒加载

### 8.1 列表项组件

**文件**: `packages/view-main/src/components/common/MusicList/List/ListItem.svelte`

```svelte
<script lang="ts">
  let picUrl = $state<null | string>(null)
  let cancelLoadPic: (() => void) | undefined = undefined

  const loadPic = () => {
    cancelLoadPic?.()
    // 使用延迟加载获取封面
    cancelLoadPic = getMusicPicDelay(
      { musicInfo: musicinfo, listId: listid, isRefresh: retryedLoadPic },
      (url) => {
        cancelLoadPic = undefined
        void tick().then(() => { picUrl = url })
      }
    )
  }

  onMount(() => {
    retryedLoadPic = false
    loadPic()  // 组件挂载时开始加载封面
    return () => { cancelLoadPic?.() }
  })
</script>

<!-- 渲染结构 -->
<div class="container">
  <div class="pic" style={picStyle}>
    <Image src={picUrl} onerror={() => { /* 重试逻辑 */ }} />
  </div>
  <div class="name-cell">
    <div class="name">{musicinfo.name}</div>  <!-- 歌名 -->
  </div>
  <div class="list-item-cell">
    <span>{musicinfo.singer}</span>  <!-- 歌手 -->
  </div>
  <div class="list-item-cell">
    <span>{musicinfo.meta.albumName}</span>  <!-- 专辑 -->
  </div>
  <div class="list-item-cell">
    <span>{musicinfo.interval || '--/--'}</span>  <!-- 时长 -->
  </div>
</div>
```

### 8.2 封面延迟加载机制

**文件**: `packages/view-main/src/modules/player/store/playerRemoteAction.ts:118-171`

```typescript
export const getMusicPicDelay = (info, onUrl) => {
  // 1. 先检查缓存
  if (!info.isRefresh) {
    const cache = getPicFromCache(info.musicInfo.id);
    if (cache) {
      onUrl(cache.url);
      return;
    }
    if (info.musicInfo.meta.picUrl) {
      onUrl(info.musicInfo.meta.picUrl);
      return;
    }
  }

  let isCanceled = false;
  let lastPicUrl = info.musicInfo.meta.picUrl;

  // 2. 监听元数据更新事件
  const unsub = musicLibraryEvent.on("listMusicUpdated", (infos) => {
    if (isCanceled) return;
    let targetMusic = findUpdatedMusic(info.musicInfo.id, infos);
    if (!targetMusic) return;

    if (targetMusic.meta.picUrl) {
      // 元数据中有了封面 URL
      if (targetMusic.meta.picUrl == lastPicUrl) return;
      onUrl(targetMusic.meta.picUrl);
    } else if (targetMusic.meta.unparsed != info.musicInfo.meta.unparsed) {
      // 元数据已解析，重新获取封面
      void handleGetMusicPic(info).then((urlInfo) => {
        if (isCanceled) return;
        onUrl(urlInfo.url);
      });
    }
  });

  // 3. 如果歌曲未解析元数据，只监听事件，不主动请求
  if (info.musicInfo.meta.unparsed) {
    return () => {
      unsub();
      isCanceled = true;
    };
  }

  // 4. 如果已解析，延迟 1 秒后主动获取封面
  let timeout = setTimeout(() => {
    void handleGetMusicPic(info).then((urlInfo) => {
      if (isCanceled) return;
      onUrl(urlInfo.url);
    });
  }, 1000);

  return () => {
    unsub();
    isCanceled = true;
    clearTimeout(timeout);
  };
};
```

### 8.3 元数据更新后的 UI 刷新

**文件**: `packages/view-main/src/modules/musicLibrary/store/commit.ts:341-365`

当元数据解析完成后，通过事件系统更新 UI：

```typescript
export const listMusicUpdateInfo = (musicInfos) => {
  const updateList = new Map<string, AnyListen.Music.MusicInfo[]>();

  for (const { id, musicInfo } of musicInfos) {
    const targetList = musicLibraryState.allMusicList.get(id);
    if (!targetList) continue;
    const index = targetList.findIndex((l) => l.id == musicInfo.id);
    if (index < 0) continue;

    // 更新内存中的歌曲信息
    const info = { ...targetList[index] };
    Object.assign(info, {
      name: musicInfo.name,
      singer: musicInfo.singer,
      interval: musicInfo.interval,
      meta: musicInfo.meta,
    });
    targetList.splice(index, 1, info);

    let list = updateList.get(id);
    if (!list) {
      list = [];
      updateList.set(id, list);
    }
    list.push(info);
  }

  // 触发事件，通知 UI 更新
  musicLibraryEvent.listMusicUpdated(updateList);
};
```

---

## 9. 缓存机制

### 9.1 多层缓存

| 缓存层         | 位置                | TTL     | 用途                 |
| -------------- | ------------------- | ------- | -------------------- |
| 目录列表缓存   | `listCache`         | 10 分钟 | 缓存 WebDAV 目录列表 |
| 音乐文件缓存   | `musicCache`        | 2 分钟  | 缓存文件元信息       |
| 元数据解析缓存 | `cache` (webdav.ts) | 60 秒   | 缓存解析结果         |
| 封面图片缓存   | `picCache` (UI)     | 100 条  | LRU 缓存封面 URL     |
| 列表封面缓存   | `cacheListCovers`   | 持久    | 缓存列表封面         |

### 9.2 目录列表缓存

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/listProviderAction.ts:18`

```typescript
const listCache = createCache<WebDAVItem[]>({ ttl: 10 * 60 * 1000 });
```

### 9.3 元数据解析缓存

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:12`

```typescript
const cache = createCache({ max: 30, ttl: 60 * 1000 });
```

### 9.4 请求去重

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:144-159`

```typescript
let requestParseMetadataPromises = new Map<string, ReturnType<typeof requestParseMetadata>>();

const handleParseMetadata = async (opts) => {
  // 检查缓存
  if (cache.has(opts.path)) return cache.get(opts.path)!;
  // 检查是否有正在进行的请求（避免重复请求）
  if (requestParseMetadataPromises.has(opts.path))
    return requestParseMetadataPromises.get(opts.path)!;

  const promise = requestParseMetadata(opts).finally(() => {
    requestParseMetadataPromises.delete(opts.path);
  });
  requestParseMetadataPromises.set(opts.path, promise);
  return promise;
};
```

---

## 10. 代理服务器机制

### 10.1 代理 URL 创建

**文件**: `packages/shared/app/modules/proxyServer/index.ts:19-29`

```typescript
export const createProxy = async (
  url: string,
  reqOptions: Options = {},
  enabledCache?: boolean,
) => {
  await verifyResource(url, reqOptions); // 验证资源可访问

  const name = generateName(url); // 生成唯一文件名
  proxyServerState.proxyMap.set(name, {
    requestOptions: reqOptions,
    url,
    enabledCache,
  });
  return buildPublicPath(proxyServerState.proxyBaseUrl, name); // 返回代理 URL
};
```

### 10.2 WebDAV 音乐播放 URL

**文件**: `packages/shared/app/modules/worker/extensionService/internalExtension/extensions/webdav/webdav.ts:197-205`

```typescript
export const getMusicUrl = async (options, path) => {
  const webDAVClient = createWebDAVClient(options);
  // 获取带认证头的请求参数
  const [url, reqOpts] = webDAVClient.getRequestOptions(path);
  // 创建代理 URL（包含认证信息）
  return hostContext.createProxyUrl(url, reqOpts, await getEnabledCache());
};
```

### 10.3 请求参数传递

**文件**: `packages/shared/nodejs/webdav-client/index.ts:175-187`

```typescript
getRequestOptions(path: string, method = 'GET'): [string, Options] {
  const url = this.getFullUrl(path)
  return [
    url,
    {
      method,
      headers: {
        Authorization: this.authHeader || '',  // 包含认证头
      },
    },
  ]
}
```

---

## 总结：完整流程图

```
用户创建远程列表
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. 验证连接 (testDir)                                        │
│    ├── PROPFIND 请求目录                                      │
│    ├── 401 错误 → 弹出密码输入框 → 重试                        │
│    └── 成功 → 继续                                            │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. 同步列表 (syncList)                                       │
│    ├── 并行获取本地列表 + 远程文件列表                           │
│    ├── 计算差异（新增/删除）                                    │
│    └── 获取新歌曲基础信息 (getMusicInfoByIds)                   │
│        ├── 只返回文件名，singer=''，unparsed=true               │
│        └── 立即添加到列表                                      │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 元数据解析                                                 │
│    ├── 非延迟模式：批量解析 (handleMusicsParseBatch)            │
│    │   ├── 每次 10 首                                         │
│    │   ├── 渐进式读取文件头（8KB → 16KB → ... → 256KB）        │
│    │   ├── 解析成功 → 更新歌手/专辑/时长                        │
│    │   └── 头部失败 → 读取文件尾部 32KB                         │
│    └── 延迟模式：跳过，等待 UI 触发                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. UI 显示                                                   │
│    ├── ListItem 组件挂载                                      │
│    │   ├── 显示歌名（来自文件名）                               │
│    │   ├── 显示歌手/专辑（来自解析后的元数据）                    │
│    │   └── 启动封面延迟加载                                    │
│    ├── 封面加载策略                                            │
│    │   ├── 检查缓存                                           │
│    │   ├── 未解析 → 监听 listMusicUpdated 事件                 │
│    │   ├── 已解析 → 延迟 1 秒后请求                            │
│    │   └── 获取顺序：同名图片 → 内嵌封面 → 目录 cover.jpg       │
│    └── 元数据更新                                              │
│        ├── listMusicUpdated 事件触发                           │
│        ├── UI 自动响应更新                                     │
│        └── 封面重新加载                                        │
└─────────────────────────────────────────────────────────────┘
```

### 关键设计要点

1. **快速显示**：首次同步只读取文件名，不解析元数据，实现秒级显示
2. **渐进增强**：元数据解析从 8KB 开始逐步增加，尽早返回可用信息
3. **延迟加载**：封面图片在组件挂载时才开始加载，未解析的歌曲等待事件触发
4. **请求去重**：同一文件的元数据解析请求会复用 Promise
5. **多级缓存**：目录、文件、元数据、封面各层独立缓存
6. **代理认证**：通过本地代理服务器转发带认证头的 WebDAV 请求
