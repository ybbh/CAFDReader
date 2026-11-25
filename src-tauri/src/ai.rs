//! 桌面宿主的 AI 网络代理：仅转发 ~/.cafdreader/cfg.toml 允许的本机/局域网端点，密钥进程隔离未实现。
use crate::{
    state::{authorize, Native},
    storage::{atomic_write, Result},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;

const MAX_REQUEST_BODY: usize = 65536;
const MAX_RESPONSE: usize = 1048576;
const MAX_INFLIGHT: usize = 4;

const DEFAULT_CONFIG: &str =
    "[ai]\nendpoints = [\"http://localhost:11434\", \"http://127.0.0.1:11434\"]\n";
#[derive(Deserialize)]
pub(crate) struct Config {
    ai: Ai,
}
#[derive(Deserialize)]
struct Ai {
    endpoints: Vec<String>,
}
pub(crate) fn config_path(home: &Path) -> PathBuf {
    home.join(".cafdreader").join("cfg.toml")
}
pub(crate) fn prepare(home: &Path) -> Result<()> {
    let path = config_path(home);
    if path.exists() {
        return Ok(());
    }
    atomic_write(&path, DEFAULT_CONFIG.as_bytes())
}
fn load(home: &Path) -> Result<Config> {
    let path = config_path(home);
    if !path.exists() {
        prepare(home)?;
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config: Config = toml::from_str(&text)
        .map_err(|_| "AI 配置无效：请修正 ~/.cafdreader/cfg.toml 的 TOML 格式".to_string())?;
    if config.ai.endpoints.len() > 16 {
        return Err("AI 配置无效：endpoints 数量过多".into());
    }
    if config
        .ai
        .endpoints
        .iter()
        .any(|e| e.len() > 256 || checked_endpoint(e).is_none())
    {
        return Err("AI 配置无效：endpoints 仅接受无路径、无认证信息的 http(s) 地址".into());
    }
    Ok(config)
}
fn authority(url: &url::Url) -> String {
    let host = match url.host() {
        Some(url::Host::Ipv6(addr)) => format!("[{addr}]"),
        Some(url::Host::Ipv4(addr)) => addr.to_string(),
        Some(url::Host::Domain(domain)) => domain.to_string(),
        None => String::new(),
    };
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    }
}
fn origin(url: &url::Url) -> String {
    format!("{}://{}", url.scheme(), authority(url))
}
fn checked_endpoint(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    url.host_str()?;
    Some(origin(&url))
}
fn checked_request_url(raw: &str, endpoints: &[String]) -> Result<url::Url> {
    let url = url::Url::parse(raw).map_err(|_| "端点地址无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("端点地址无效".into());
    }
    if !matches!(url.path(), "/api/tags" | "/api/chat") {
        return Err("仅允许访问 /api/tags 与 /api/chat".into());
    }
    let allowed = endpoints
        .iter()
        .filter_map(|e| checked_endpoint(e))
        .any(|e| e == origin(&url));
    if !allowed {
        return Err("端点未列入 ~/.cafdreader/cfg.toml 的 ai.endpoints".into());
    }
    Ok(url)
}
#[derive(Deserialize)]
pub(crate) struct AiRequest {
    id: String,
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct AiReply {
    status: u16,
    body: Vec<u8>,
}
fn read_line(reader: &mut impl BufRead, limit: usize) -> Result<String> {
    let mut buf = Vec::new();
    loop {
        let mut byte = [0u8; 1];
        let n = reader.read(&mut byte).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("连接提前关闭".into());
        }
        if byte[0] == b'\n' {
            break;
        }
        if byte[0] != b'\r' {
            buf.push(byte[0]);
        }
        if buf.len() > limit {
            return Err("响应头过大".into());
        }
    }
    String::from_utf8(buf).map_err(|_| "响应头无效".into())
}
fn read_body(reader: &mut impl BufRead, headers: &HashMap<String, String>) -> Result<Vec<u8>> {
    if let Some(length) = headers.get("content-length") {
        let length: usize = length.parse().map_err(|_| "响应头无效".to_string())?;
        if length > MAX_RESPONSE {
            return Err("响应过大".into());
        }
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body).map_err(|e| e.to_string())?;
        return Ok(body);
    }
    if headers
        .get("transfer-encoding")
        .is_some_and(|v| v.eq_ignore_ascii_case("chunked"))
    {
        let mut body = Vec::new();
        loop {
            let size = read_line(reader, 64)?;
            let size = usize::from_str_radix(size.split(';').next().unwrap_or(""), 16)
                .map_err(|_| "分块响应无效".to_string())?;
            if size == 0 {
                while !read_line(reader, 8192)?.is_empty() {}
                break;
            }
            if body.len() + size > MAX_RESPONSE {
                return Err("响应过大".into());
            }
            let start = body.len();
            body.resize(start + size, 0);
            reader
                .read_exact(&mut body[start..])
                .map_err(|e| e.to_string())?;
            let mut crlf = [0u8; 2];
            reader.read_exact(&mut crlf).map_err(|e| e.to_string())?;
        }
        return Ok(body);
    }
    let mut body = Vec::new();
    reader
        .take((MAX_RESPONSE + 1) as u64)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() > MAX_RESPONSE {
        return Err("响应过大".into());
    }
    Ok(body)
}
fn exchange(
    state: &Native,
    url: &url::Url,
    method: &str,
    headers: &[(String, String)],
    body: &[u8],
    id: &str,
) -> Result<AiReply> {
    if url.scheme() == "https" {
        return Err("桌面 AI 代理暂不支持 HTTPS 端点，请改用本机/局域网 http 地址".into());
    }
    let host = url.host_str().ok_or("端点地址无效")?;
    let port = url.port_or_known_default().ok_or("端点地址无效")?;
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("端点无法解析")?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .map_err(|e| format!("无法连接端点：{e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    {
        let mut map = state.ai_streams.lock().map_err(|e| e.to_string())?;
        if map.len() >= MAX_INFLIGHT {
            return Err("AI 请求过多，请稍后重试".into());
        }
        map.insert(
            id.to_string(),
            stream.try_clone().map_err(|e| e.to_string())?,
        );
    }
    let result = roundtrip(&mut stream, url, method, headers, body);
    if let Ok(mut map) = state.ai_streams.lock() {
        map.remove(id);
    }
    result
}
fn roundtrip(
    stream: &mut TcpStream,
    url: &url::Url,
    method: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<AiReply> {
    let mut text = format!(
        "{method} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
        url.path(),
        authority(url)
    );
    for (key, value) in headers {
        text.push_str(&format!("{key}: {value}\r\n"));
    }
    if method == "POST" {
        text.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    text.push_str("\r\n");
    let mut request = text.into_bytes();
    request.extend_from_slice(body);
    stream.write_all(&request).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let status = read_line(&mut reader, 8192)?;
    let status: u16 = status
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("响应状态无效")?;
    let mut response_headers = HashMap::new();
    loop {
        let line = read_line(&mut reader, 8192)?;
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            response_headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Ok(AiReply {
        status,
        body: read_body(&mut reader, &response_headers)?,
    })
}
#[tauri::command]
pub(crate) async fn ai_fetch(
    app: tauri::AppHandle,
    token: String,
    request: AiRequest,
) -> Result<AiReply> {
    authorize(app.state::<Native>().inner(), &token)?;
    if request.id.is_empty()
        || request.id.len() > 64
        || !request
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("请求标识无效".into());
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let config = load(&home)?;
    let url = checked_request_url(&request.url, &config.ai.endpoints)?;
    let method = request.method;
    if !matches!(method.as_str(), "GET" | "POST") {
        return Err("仅支持 GET 与 POST".into());
    }
    let body = request.body.unwrap_or_default();
    if method == "GET" && !body.is_empty() {
        return Err("GET 不携带请求体".into());
    }
    if body.len() > MAX_REQUEST_BODY {
        return Err("请求体过大".into());
    }
    let mut headers = Vec::new();
    for (key, value) in request.headers.unwrap_or_default() {
        if !matches!(key.to_ascii_lowercase().as_str(), "content-type" | "authorization") {
            continue;
        }
        if value.len() > 4096 || value.bytes().any(|b| b == b'\r' || b == b'\n') {
            return Err("请求头无效".into());
        }
        headers.push((key, value));
    }
    let id = request.id;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Native>();
        exchange(&state, &url, &method, &headers, body.as_bytes(), &id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn ai_abort(state: tauri::State<Native>, token: String, id: String) -> Result<()> {
    authorize(&state, &token)?;
    if let Ok(mut map) = state.ai_streams.lock() {
        if let Some(stream) = map.remove(&id) {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
    Ok(())
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;
    use crate::state::Native;
    use crate::storage::Store;
    use std::net::TcpListener;
    use std::sync::Mutex;
    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cafd-ai-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn native(dir: &Path) -> Native {
        Native {
            store: Mutex::new(Store::new(dir.to_path_buf()).unwrap()),
            token: String::new(),
            pending: Mutex::new(Vec::new()),
            smoke: None,
            ai_streams: Mutex::new(HashMap::new()),
        }
    }
    #[test]
    fn default_config_created_once() {
        let home = temp_home("config");
        prepare(&home).unwrap();
        let text = std::fs::read_to_string(config_path(&home)).unwrap();
        assert!(text.contains("http://localhost:11434"));
        std::fs::write(config_path(&home), "[ai]\nendpoints = []\n").unwrap();
        prepare(&home).unwrap();
        assert!(load(&home).unwrap().ai.endpoints.is_empty());
        std::fs::write(config_path(&home), "endpoints = [").unwrap();
        assert!(load(&home).is_err());
        std::fs::remove_dir_all(&home).ok();
    }
    #[test]
    fn endpoints_are_checked() {
        assert_eq!(
            checked_endpoint("http://localhost:11434").as_deref(),
            Some("http://localhost:11434")
        );
        assert!(checked_endpoint("http://localhost:11434/").is_some());
        assert!(checked_endpoint("http://user@localhost:11434").is_none());
        assert!(checked_endpoint("http://localhost:11434/api").is_none());
        assert!(checked_endpoint("ftp://localhost:11434").is_none());
    }
    #[test]
    fn request_urls_must_be_listed() {
        let endpoints = vec!["http://localhost:11434".to_string()];
        assert!(checked_request_url("http://localhost:11434/api/tags", &endpoints).is_ok());
        assert!(checked_request_url("http://127.0.0.1:11434/api/tags", &endpoints).is_err());
        assert!(checked_request_url("http://localhost:11434/api/pull", &endpoints).is_err());
        assert!(checked_request_url("http://localhost:11434/api/tags?x=1", &endpoints).is_err());
    }
    fn serve_once(response: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut byte = [0u8; 1];
            while !received.ends_with(b"\r\n\r\n") {
                if stream.read(&mut byte).unwrap() == 0 {
                    break;
                }
                received.push(byte[0]);
            }
            let text = String::from_utf8_lossy(&received);
            let length: usize = text
                .lines()
                .find_map(|l| {
                    let lower = l.to_ascii_lowercase();
                    lower
                        .strip_prefix("content-length:")
                        .and_then(|v| v.trim().parse().ok())
                })
                .unwrap_or(0);
            let mut body = vec![0u8; length];
            stream.read_exact(&mut body).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            format!("{text}{}", String::from_utf8_lossy(&body))
        });
        (port, handle)
    }
    #[test]
    fn post_roundtrip_and_abort() {
        let dir = temp_home("http");
        let state = native(&dir);
        let (port, server) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}",
        );
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/api/chat")).unwrap();
        let reply = exchange(
            &state,
            &url,
            "POST",
            &[("Content-Type".to_string(), "application/json".to_string())],
            b"{\"model\":\"m\"}",
            "t-1",
        )
        .unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body, b"{\"ok\":true}");
        let sent = server.join().unwrap();
        assert!(sent.starts_with("POST /api/chat HTTP/1.1\r\n"));
        assert!(sent.ends_with("{\"model\":\"m\"}"));
        assert!(state.ai_streams.lock().unwrap().is_empty());
        let (port, server) = serve_once("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nwiki\r\n5\r\npedia\r\n0\r\n\r\n");
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/api/tags")).unwrap();
        let reply = exchange(&state, &url, "GET", &[], b"", "t-2").unwrap();
        assert_eq!(reply.body, b"wikipedia");
        server.join().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            std::thread::sleep(Duration::from_secs(5));
            drop(stream);
        });
        std::thread::scope(|scope| {
            let pending = scope.spawn(|| {
                let url = url::Url::parse(&format!("http://127.0.0.1:{port}/api/tags")).unwrap();
                exchange(&state, &url, "GET", &[], b"", "t-3")
            });
            std::thread::sleep(Duration::from_millis(200));
            if let Some(stream) = state.ai_streams.lock().unwrap().remove("t-3") {
                let _ = stream.shutdown(Shutdown::Both);
            }
            assert!(pending.join().unwrap().is_err());
        });
        std::fs::remove_dir_all(&dir).ok();
    }
}
