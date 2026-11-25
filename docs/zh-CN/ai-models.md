# AI 模型：第零期操作与验收

本期增加实验性 `caf:llm/v1`，不修改书籍内容。协议见
[LLM v1](../../spec/zh-CN/llm-v1.md)。正式李白问答、引用核验、地图和飞花令尚未实现。

## 构建与运行

先在本地 CAF 项目构建更新后的 CLI：`cargo build --bin caf-tool --offline`。
在 CAFDReader 中使用已有依赖环境运行：

```sh
CAF_TOOL=/绝对路径/caf/target/debug/caf-tool npm run ai:build
npm run test:llm
python3 scripts/serve_offline.py
```

构建命令连续两次构建并校验独立夹具，要求两次 SHA-256 相同；输出为
`build/llm-fixture.cafd` 和 `dist-host/`。准备环境需要已安装 Rust wasm32-unknown-unknown
目标、Python 3 和项目 Node 依赖。正式分发不得依赖 CAFDReader 之外的书籍数据目录。

打开 `http://127.0.0.1:8612/reader/`，通过文件选择打开夹具。运行浏览器验收：

```sh
BASE=http://127.0.0.1:8612 npm run test:llm-browser
```

脚本逐一检查 Chrome、Firefox、WebKit 的 390/1280 像素界面，生成
`build/llm-browser-report.json`；任一失败返回非零。需要与 Playwright 版本匹配的浏览器。
可以用 CAFD_CHROME_EXECUTABLE、CAFD_FIREFOX_EXECUTABLE、CAFD_WEBKIT_EXECUTABLE
显式指定测试二进制，但旧二进制不保证协议兼容。

## 局域网离线准备

断网指断公网，手机、静态宿主和 Ollama 仍可通过局域网通信。手机 localhost 不是电脑。

1. 事先安装模型。Reader 的“模型准备”窗口提供手工拉取/离线导入说明；不代执行命令。
2. 由用户配置 Ollama 的监听地址和允许的 Reader origin，不自动更改服务设置。
3. 手机访问 Reader 必须使用设备信任的 HTTPS，保证 Web Crypto 可用。
4. 提供方端点同样须满足浏览器混合内容/CORS/本地网络策略。跨浏览器最稳妥的是为
   Ollama 配置可信 HTTPS 前端；普通 HTTPS 网页访问局域网 HTTP 不能保证成功。
   TLS 前端属于部署准备，不是书内能力，也不由 Reader 静态服务器实现。
5. 使用有效证书启动静态宿主，证书和私钥不要放入静态根目录或 CAF：

```sh
python3 scripts/serve_offline.py --host 0.0.0.0 --port 8612 --cert /安全位置/server.pem --key /安全位置/server-key.pem
```

服务器支持 Range 和关闭目录列表。Reader 不依赖 CDN，也未添加 PWA 缓存；离线启动
依赖局域网静态服务。该工具用于受控演示网络，不替代生产静态服务。

## 配置与授权

从书架的“AI 模型”链接进入 Reader，再在 Reader 内打开文件，避免页面导航导致内存
配置丢失。本地默认端点 `http://localhost:11434`；检测已安装模型并选择。云端默认禁用，
通过独立复选框启用；启用后端点和模型名必填。兼容端点填写到 `/v1` 等 API 基路径，
Reader 添加 `/chat/completions`。空密钥仅适用于服务允许匿名访问的情况。

“应用配置”不代表连接成功；使用“连接测试 / 预热”确认，测试用量也计入统计。
“允许”记住构件/组件/档位的决定，“仅本次”只覆盖本次打开，拒绝不发送数据。
“撤销所有 AI 授权”同时取消在途请求。修改端点会中断现有请求。配置、密钥、端点、
签名私钥及统计仅在当前页面内存，刷新或离开后需重配；授权决定可持久保存。

## 第零期演示（约三分钟）

- 0:00–0:30：打开 Reader，选择独立 AI 夹具，未配置时显示 unavailable。
- 0:30–1:10：检测已预装模型，连接测试/预热；显示模型和延迟。
- 1:10–1:50：提问，先拒绝，再选择仅本次；展示宿主代发后的回答。
- 1:50–2:30：展开宿主 receipt，检查签名、响应哈希和用量，导出统计。
- 2:30–3:00：禁用本地后端，再提问，展示诚实降级，不冒充知识问答。

完整“问李白→引用→地图→飞花令”脚本及指定收尾句在第三期交付，本期不演示不存在的功能。

## 自测表与当前证据

| 场景 | 自动化入口 | 当前结果 |
| --- | --- | --- |
| 无 LLM 声明、未知版本、profile 冲突、普通网络拒绝 | Rust security / Web admit | 通过 |
| Rust/Web 相同命令及边界 | llm-vectors.json | 通过 |
| 未配置后端、无可用模型 | llm.spec.mjs / llm-runtime.spec.mjs | 通过 |
| 允许、拒绝、仅本次及跨构件隔离 | llm.spec.mjs | 通过（服务层） |
| 本地与云端请求及未知 token | llm.spec.mjs | 通过（模拟提供方） |
| 超时、取消、迟到完成、队列上限 | llm.spec.mjs / Rust mailbox | 通过 |
| 端点/密钥不进入结果、公告、导出 | llm.spec.mjs | 通过 |
| receipt 验签、篡改拒绝、响应哈希 | llm.spec.mjs / llm-runtime.spec.mjs | 通过 |
| 真实容器→WASM→邮箱→服务→签名响应 | llm-runtime.spec.mjs | 通过（模拟提供方） |
| 双次构建同哈希、caf-tool verify | build_llm_fixture.py | 通过 |
| 构建拒绝缺声明、未知版本与矛盾 profile | llm-build.spec.py | 通过 |
| 现有李白/Tetris 元信息与应用入口，李白目录/原文 | Node 运行时回归 | 通过，未改动原文件 |
| Rust CLI 无提供方的模型公告 | caf-tool run --fn llm-discover | 通过，空列表 |
| Chrome/Firefox/WebKit UI 与授权弹窗 | llm-browser.spec.mjs | 待通过，见下方限制 |
| 真实 Ollama / qwen2.5:7b | 用户提供的 2026-11-19 实测 receipt | 成功；响应哈希与签名已复核 |
| 局域网手机、断公网 | 人工环境验收 | 未完成 |
| 旧李白与 Tetris 完整浏览器回归 | 浏览器环境验收 | 未完成 |

## 已知限制与许可

- 当前执行环境阻止 Chrome/WebKit 创建所需套接字；现有 Firefox 缓存与 Playwright
  协议版本不匹配。浏览器测试失败不是通过；报告保留具体错误。
- 原有 unit 汇总中的 reader-build-logic 子进程测试遇到 spawnSync EPERM；新功能
  单元测试、真实 WASM 链路与 Rust workspace 测试可独立运行。没有删除或放宽旧断言。
- 本执行环境禁止建立套接字，不能据此判断用户的 Ollama 是否启动。用户已实测连接成功（4064 ms），并提供一次成功构件调用（207 ms，31 输入 / 10 输出 token）；响应哈希、会话签名及篡改拒绝已离线复核。这不是长问答性能、局域网手机或三浏览器验收。
- 原生 Rust runtime 已有受控邮箱 SDK；原生 Reader Rust 网络代理和密钥进程隔离未实现。
  浏览器版只承诺秘密隔离于书内应用，不能抵御宿主被攻破或有权读取页面的浏览器扩展。
- receipt 为会话自签记录；模型 digest 为配置时观察值，不是模型权重执行证明。
- 第零期不含诗集索引和引用核验。夹具明确声明没有可验证引用。
- 未新增第三方依赖包；Rust runtime 复用 workspace 的 serde/serde_json，Web 复用
  浏览器 Fetch/Web Crypto/DOM，测试复用已有 Playwright。LLM 模型由用户自行准备，
  不随 CAF 分发；模型和云端服务条款需分别遵守。
- 未导入江山时序任何代码、数据或素材，未使用 CHGIS。第二期许可边界保持既定计划。

## 代码评审必查项

API Key 和端点仅存在宿主内存；检查组件内存、iframe、桥接消息、异常、日志、
持久化存储和导出文件均无秘密；组件不能指定 URL、HTTP 头或获取任意网络能力。
授权不跨根哈希，换书和取消后的迟到响应不回流；错误不伪造 token/模型哈希/引用。

## 接口参考

- [Ollama chat](https://docs.ollama.com/api/chat)
- [Ollama model import](https://docs.ollama.com/import)
- [Web Crypto secure context](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle)
