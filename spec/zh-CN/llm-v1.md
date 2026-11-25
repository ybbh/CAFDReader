# caf:llm/v1 — 实验性宿主代发能力

状态：实验性 v1，独立于未变更的 `caf:doc-web@1`。保留原文档 profile/WIT，
不提供任意网络桥接。

## 准入与 ABI

manifest/build 策略声明 `llm = "caf:llm@1"`，执行必须使用
`profile = "caf-x1"`、`deterministic = false`。普通网络、文件系统、时钟、
随机数仍设为 false。不声明 LLM 时保留旧序列化。未知版本、未声明导入拒绝；
旧运行时拒绝新策略/profile，不将其悄悄作为 caf-d1 执行。

[llm.wit](../llm.wit) 的包名为 `caf:llm@1.0.0`。这里使用现有 CAF 核心模块 ABI，
并非自动 Component Model canonical lowering。WIT host exchange 显式映射为
核心导入 `caf:llm/v1.exchange(i32,i32,i32,i32)->i32`，参数依次为请求指针/长度、
响应指针/容量。请求为 UTF-8 JSON，最多 32768 字节；响应缓冲区必须恰为
131072 字节。返回写入字节数，内存或预算无效返回 -1；JSON/UTF-8 无效返回 invalid。副作用前检查内存并
预留最大响应预算，小缓冲区重试不会重复提交。

独立夹具导入宿主 WIT，导出原文档接口及测试操作。正式 ask/find/describe 属于第一期。

## JSON 命令

只接受列出的字段。命令同步返回，立即让出宿主事件循环；不依赖 JSPI、同步网络或共享
内存。Worker 在串行调用队列之外处理宿主完成消息。

- `{"op":"discover"}`：返回 ready、protocol、backends。每个后端仅含 tier
  （local/cloud）、model、可空的提供方 digest，不含端点和密钥。
- `{"op":"submit","model_hint":"auto","prompt":"...","max_tokens":128,"temperature":0}`：
  返回 pending 与数字 id，或 unavailable/invalid/limit。
- `{"op":"poll","id":1}`：返回当前状态；不存在的任务返回 unknown。
- `{"op":"cancel","id":1}`：在途任务变 cancelled，终态保持不变；迟到完成不得覆盖取消。

model_hint 仅允许 auto/local/cloud；prompt 为 1–16384 个 UTF-8 字节；max_tokens 为
1–1024；temperature 为有限数值 0–2。每个组件实例最多两个在途任务、累计 128 个任务。
终态保留至关闭，可重复查询。完成状态包括 completed/denied/unavailable/error/
cancelled/limit/invalid。取消对提供方仅为尽力执行，中断后对方仍可能产生用量。

LLM 声明仅允许调用受控导入，不代表已获发送授权。Reader 按完整构件根哈希、组件和
档位授权；“允许”持久保存决定，“仅本次”限当前书籍会话。不同根哈希和档位不共享
授权。配置变化取消在途请求。本地失败不静默转云端。

## receipt 与信任

Reader 为每个实际发出的请求使用临时、不可导出的 Web Crypto ECDSA P-256 私钥签名。
receipt 正文包含 protocol、root_hash、component、会话单调递增的 call_id、task_id、
backend、model、configured_model、model_source、可空 model_digest、model_digest_source、parameters、
request_hash、response_hash、timestamp、latency_ms、status、code、usage、
signature_algorithm、trust。model_digest_source 为 listing-at-configuration 时，
仅表示配置时从 Ollama 列表观察到的 digest，不是已加载权重的远程证明。
model_source 区分提供方响应与配置回退；提供方返回不同模型时清除 digest。云端模型名不代表固定权重。

签名字节为对象键递归排序、数组顺序不变、无空白的 UTF-8 JSON；public_key（公开 JWK）
和 signature（十六进制原始 r||s）不在签名正文内。用随附公钥验证只证明会话记录，
不建立独立可信宿主身份。请求哈希覆盖规范化提供方请求体，不含 HTTP 头与端点；
响应哈希覆盖防御性密钥清理后、实际交给组件的 UTF-8 文本。未交付答案的错误/取消调用
response_hash 为 null。未知用量为 null，不记零。时间来自宿主时钟，不是可信时间戳。

AI 标识归宿主所有。第零期没有引用核验器，明确显示“无可验证引用”；签名不证明事实
正确。第一期逐条验证 payload 引用后才可显示该引用通过。

## 生命周期与限制

授权和签名密钥准备完成后，提供方请求限时十秒；授权等待不计入生成延迟。
提供方响应上限 256 KiB，答案文本上限 32 KiB。拒绝重定向，不携带浏览器环境凭据；
不向组件回显原始网络异常或提供方错误正文。Reader 内存最多保存 128 条 receipt，
支持统计清零与导出；清零不删除已展示记录，不改写 CAF。界面最多保留 20 条记录。
关书取消任务、清除本次授权及展示；刷新/导航清除配置、秘密、签名密钥和用量。
持久授权独立保留，可撤销。

Rust caf-runtime 提供非阻塞 Mailbox SDK：公告公开模型、取出请求，由嵌入宿主负责
授权/传输/receipt，再完成任务。CLI 不安装提供方，诚实返回无可用后端。
本次浏览器优先交付未实现原生 Reader Rust 网络代发，不据此声称原生进程密钥隔离。
