use crate::settings::Settings;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    pub http: reqwest::Client,
    pub settings: RwLock<Settings>,
    pub data_dir: PathBuf,
    /// Per-host timestamp of the last automated request, for rate limiting.
    last_request: Mutex<HashMap<String, Instant>>,
}

/// A browser-like UA helps with publisher sites that block obvious bots when
/// fetching PDFs the user is entitled to. API calls use honest identification
/// via the `mailto` parameter / headers where the service supports it.
pub const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

impl AppState {
    pub fn new(data_dir: PathBuf, settings: Settings) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(BROWSER_UA)
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(120))
            // Reliability over multiplexing: HTTP/2 uploads have stalled
            // against api.anthropic.com on iPad (h2 flow-control + POST
            // bodies), and h1.1 is fine for everything this app does.
            .http1_only()
            // iPads hop networks and suspend the app; a pooled connection
            // that died meanwhile hangs a non-idempotent request until the
            // full timeout. Keep pooled connections short-lived instead.
            .pool_idle_timeout(Duration::from_secs(30))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");
        AppState {
            http,
            settings: RwLock::new(settings),
            data_dir,
            last_request: Mutex::new(HashMap::new()),
        }
    }

    pub fn tmp_dir(&self) -> PathBuf {
        self.data_dir.join("tmp")
    }

    /// Wait until at least `rate_limit_ms` has passed since the previous
    /// request to `host`. Holds the lock during the sleep, which serializes
    /// automated downloads — intentional politeness.
    pub async fn throttle(&self, host: &str) {
        let min = {
            let s = self.settings.read().await;
            Duration::from_millis(s.rate_limit_ms.max(250))
        };
        let mut map = self.last_request.lock().await;
        if let Some(last) = map.get(host) {
            let elapsed = last.elapsed();
            if elapsed < min {
                tokio::time::sleep(min - elapsed).await;
            }
        }
        map.insert(host.to_string(), Instant::now());
    }
}

pub fn host_of(url: &str) -> String {
    url.parse::<reqwest::Url>()
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "unknown".into())
}
