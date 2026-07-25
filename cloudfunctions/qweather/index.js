// 微信云函数：和风天气代理（KEY 只存服务端环境变量，前端零密钥）
// 部署：微信开发者工具 -> 右键 cloudfunctions/qweather -> 上传并部署：云端安装依赖
// 环境变量：
//   QWEATHER_KEY        = 主用 KEY（必填）
//   QWEATHER_KEY_BACKUP = 备用 KEY（选填，主 key 不可用时自动切换）
//   QWEATHER_HOST       = 自定义天气 host（选填，如 https://pm5xmfmtjk.re.qweatherapi.com）
//   QWEATHER_GEO_HOST   = 自定义 Geo host（选填，默认按天气 host 自动推导）
//   QWEATHER_DIAG       = 诊断模式开关（选填，置 '1' 才开启 __test__ 诊断分支；默认关闭，杜绝 KEY 泄露）
//   ⚠️ 注意：备用 KEY 也请用干净的 key；切勿把已泄露的旧 key 作为 backup。
//   ⚠️ 绑定了“自定义域名”套餐的 key 只能用其专属 host，用 api/devapi 会 403 Invalid Host。
//
// 说明：仅使用 Node 内置模块（https / url / zlib），兼容云函数 Node 16 / 18 运行时。
//
// 设计原则：exports.main 外层有总兜底 try/catch，确保【永远返回一个可序列化对象】，
// 不会让平台把异常包成 {error:{...}} 信封（那样前端拿不到可读错误）。
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');

// 诊断模式开关（默认关闭）：须由运维在云函数环境变量显式设置 QWEATHER_DIAG=1 才启用。
// 避免任何调用方（即便已登录）都能触发诊断、枚举可用 host，并彻底杜绝 KEY 片段外泄到前端。
const ENABLE_DIAG = process.env.QWEATHER_DIAG === '1';

// 收集所有非空 key（主 -> 备）
const KEYS = [process.env.QWEATHER_KEY, process.env.QWEATHER_KEY_BACKUP].filter(Boolean);

// 自定义 Host（可选）：和风“自定义域名/专属 Host”套餐给的私有接入点。
//   例如某 key 绑定 pm5xmfmtjk.re.qweatherapi.com。这类 key 只能在该专属 host 上用，
//   用标准 api/devapi 会 403 Invalid Host。填了之后排到最前优先尝试。
//   ⚠️ 实测：自定义 Geo host 不能按“qweatherapi.com → geoapi.qweather.com”推导（该域名不存在），
//       Geo 接口在自定义域名下通常就挂在【同一个自定义天气 host】的 /v2/... 路径上。
//   - QWEATHER_HOST：自定义天气 host（含 https://，必填才能启用自定义模式）
//   - QWEATHER_GEO_HOST：自定义 Geo host（不填则复用 QWEATHER_HOST 同一个 host）
const CUSTOM_WEATHER_HOST = process.env.QWEATHER_HOST
  ? process.env.QWEATHER_HOST.replace(/\/$/, '')
  : null;
const CUSTOM_GEO_HOST = process.env.QWEATHER_GEO_HOST
  ? process.env.QWEATHER_GEO_HOST.replace(/\/$/, '')
  : (CUSTOM_WEATHER_HOST || null);

// 天气类域名：自定义 host 排前，再回退标准版/开发版（通吃两种类型 key）。
const WEATHER_HOSTS = [
  ...(CUSTOM_WEATHER_HOST ? [CUSTOM_WEATHER_HOST] : []),
  'https://api.qweather.com',
  'https://devapi.qweather.com'
];
// Geo 类域名：自定义 geo host 排前，再回退 geoapi.qweather.com。
const GEO_HOSTS = [
  ...(CUSTOM_GEO_HOST ? [CUSTOM_GEO_HOST] : []),
  'https://geoapi.qweather.com'
];

// path 白名单：仅放行下列和风合法端点（防止代理被滥用为请求任意/付费端点的跳板）
const ALLOWED_PATHS = [
  /^v7\/weather\/(now|7d|24h|72h)$/,
  /^v7\/indices\/(1d|1h|15d)$/,
  /^v7\/air\/(now|5d)$/,
  /^v7\/minutely\/5m$/,
  /^geo\/v2\/city\/lookup$/
];

const TIMEOUT = 5000; // 内部超时（小于云函数超时，确保拿到可读错误）

// 模块级内存缓存（云函数实例可能复用，省额度）
const cache = new Map();
const TTL = 10 * 60 * 1000; // 10 分钟

// 判断是否“Invalid Host”类错误（key 与 host 不匹配）
function isInvalidHost(data) {
  if (!data || !data.error) return false;
  const s = ((data.error.title || '') + ' ' + (data.error.detail || '')).toLowerCase();
  return /invalid host|unauthorized api host/.test(s);
}

// 重定向白名单：仅允许跳转到和风天气/Geo 域名，杜绝 SSRF（跳内网/元数据 169.254.169.254 等）
const ALLOWED_REDIRECT_HOSTS = new Set(
  [...WEATHER_HOSTS, ...GEO_HOSTS]
    .map((h) => { try { return new URL(h).hostname; } catch (e) { return ''; } })
    .filter(Boolean)
);

// 用 Node 内置 https 发 GET 请求（兼容 Node 16+）
// 返回 { statusCode, body }；自动处理 gzip/deflate、跟随最多 3 次重定向（重定向目标限白名单 host）。
function doRequest(urlStr, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { return reject(new Error('bad url: ' + urlStr)); }

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'weather-miniapp-proxy',
        'Accept': 'application/json, */*'
      }
    };

    const req = https.request(options, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = (resp.headers['content-encoding'] || '').toLowerCase();
        const decode = (raw) => new Promise((res, rej) => {
          if (enc === 'gzip') zlib.gunzip(raw, (e, d) => e ? rej(e) : res(d));
          else if (enc === 'deflate') zlib.inflate(raw, (e, d) => e ? rej(e) : res(d));
          else res(raw);
        });
        decode(buf).then((textBuf) => {
          const text = textBuf.toString('utf8');
          const status = resp.statusCode;
          if ([301, 302, 303, 307, 308].includes(status) && resp.headers.location && redirectDepth < 3) {
            // SSRF 防护：重定向目标 host 必须落在白名单，禁跳内网/元数据(169.254.169.254)
            try {
              const next = new URL(resp.headers.location, urlStr);
              if (!ALLOWED_REDIRECT_HOSTS.has(next.hostname)) {
                return reject(new Error('redirect to disallowed host: ' + next.hostname));
              }
              return resolve(doRequest(next.toString(), redirectDepth + 1));
            } catch (e) {
              return reject(new Error('bad redirect url: ' + resp.headers.location));
            }
          }
          resolve({ statusCode: status, body: text });
        }).catch(reject);
      });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout (' + TIMEOUT + 'ms)')));
    req.on('error', (e) => reject(e));
    req.end();
  });
}

function buildUrl(base, cleanPath, params, key) {
  const url = new URL(base + '/' + cleanPath);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set('key', key); // 服务端注入 KEY
  return url.toString();
}

// 用某个 key + 某个 host 发一次请求。只缓存成功响应，避免缓存错误。
async function tryHost(base, cleanPath, params, key) {
  const urlStr = buildUrl(base, cleanPath, params, key);
  const hit = cache.get(urlStr);
  if (hit && Date.now() - hit.t < TTL) return hit.data;

  const { statusCode, body } = await doRequest(urlStr);
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    const snippet = (body || '').slice(0, 300).replace(/\s+/g, ' ');
    console.error(`[qweather] non-JSON upstream (status ${statusCode}): ${snippet}`);
    return { code: 'ERR', message: `upstream non-JSON (status ${statusCode}): ${snippet}` };
  }
  if (data && data.code === '200') {
    cache.set(urlStr, { t: Date.now(), data });
    if (cache.size > 200) cache.clear();
  }
  return data;
}

// 带容错的单次请求：网络/DNS/超时等异常不再上抛（否则会变成 function crashed），
// 而是返回一个带 _netFail 标记的对象，让外层循环记录后继续尝试下一个 key/host 组合。
async function tryHostSafe(base, cleanPath, params, key) {
  try {
    return await tryHost(base, cleanPath, params, key);
  } catch (e) {
    const msg = (e && e.code) ? (e.code + ' ' + (e.message || '')) : (e && e.message ? e.message : String(e));
    return { _netFail: true, message: msg };
  }
}

// 真正的业务入口（会被外层 try/catch 包住）
async function realMain(event) {
  const { path, params = {} } = event || {};
  if (!path) return { code: 'ERR', message: 'missing path' };
  if (!KEYS.length) return { code: 'ERR', message: 'QWEATHER_KEY not set in env' };

  // 诊断模式：穷举 host（不暴露 KEY），把每次结果列出来，一眼看清哪个组合能用
  if (path === '__test__') {
    if (!ENABLE_DIAG) {
      return { code: 'ERR', message: 'diagnostic mode disabled (set QWEATHER_DIAG=1 to enable)' };
    }
    const attempts = [];
    for (const key of KEYS) {
      for (const host of WEATHER_HOSTS) {
        const r = await tryHostSafe(host, 'v7/weather/now', { location: '101010100', lang: 'zh' }, key);
        const res = r && r._netFail
          ? ('NETFAIL:' + r.message)
          : (r && r.code ? r.code : (r && r.error ? r.error.title : '?'));
        // 注意：attempts 只返回 host 与结果，绝不回传 KEY 任何片段
        attempts.push({ host: host.replace('https://', ''), result: res });
        if (r && r.code === '200') return { code: 'DIAG', ok: true, diag: r, attempts };
      }
    }
    // 若配了自定义 host，额外验证 Geo 通路（自定义 host 的 Geo 路径需带 /geo 前缀）
    if (CUSTOM_GEO_HOST) {
      for (const key of KEYS) {
        const r = await tryHostSafe(CUSTOM_GEO_HOST, 'geo/v2/city/lookup', { location: 'beijing', number: 1, lang: 'zh' }, key);
        const res = r && r._netFail
          ? ('NETFAIL:' + r.message)
          : (r && r.code ? r.code : (r && r.error ? r.error.title : '?'));
        attempts.push({ host: CUSTOM_GEO_HOST.replace('https://', '') + '(geo)', result: res });
        if (r && r.code === '200') return { code: 'DIAG', ok: true, diag: r, attempts };
      }
    }
    return { code: 'DIAG', ok: false, attempts };
  }

  // path 白名单：仅放行和风合法端点，禁止请求任意/付费端点（防代理被滥用为跳板）
  const cleanPath = String(path).replace(/^\/+/, '');
  if (!ALLOWED_PATHS.some((re) => re.test(cleanPath))) {
    return { code: 'ERR', message: 'path not allowed: ' + cleanPath };
  }

  // 先统一去掉所有前导斜杠，避免 '/geo/v2/...' 与 'geo/v2/...' 两种写法行为不一致
  let p = cleanPath;
  // path 形如 'v7/weather/now' 或 'geo/v2/city/lookup'
  const isGeo = p.startsWith('geo/') || p.includes('city/lookup');
  // 基础路径：去掉命名空间用的 'geo/' 前缀，得到真正的接口路径（如 v2/city/lookup）。
  // 注意：标准 geoapi.qweather.com 用 /v2/city/lookup（无 geo 前缀，已验证 200）；
  //       自定义 host 用 /geo/v2/city/lookup（必须带 geo 前缀，官方文档示例+实测确认）。
  //       “是否保留 /geo 前缀”取决于用的是哪种 host，见下方循环的 effPath。
  let basePath = isGeo ? p.replace(/^geo\/?/, '') : p;
  basePath = basePath.replace(/^\/+/, '');
  const hosts = isGeo ? GEO_HOSTS : WEATHER_HOSTS;

  const attempts = [];
  for (const key of KEYS) {
    for (const host of hosts) {
      // 自定义 Geo host 需保留 /geo 前缀；标准 geoapi 用去掉前缀的 /v2 路径
      const effPath = (isGeo && host === CUSTOM_GEO_HOST) ? ('geo/' + basePath) : basePath;
      let data = await tryHostSafe(host, effPath, params, key);
      // 网络/DNS/超时等异常：记录后跳过，继续尝试下一个 key/host，绝不整体崩溃
      if (data && data._netFail) {
        console.warn(`[qweather] net fail on ${host} (key ${key.slice(0, 6)}…): ${data.message}`);
        attempts.push(`${host.replace('https://', '')}: ${data.message}`);
        continue;
      }
      if (isInvalidHost(data)) {
        console.warn(`[qweather] Invalid Host on ${host} (key ${key.slice(0, 6)}…), skip`);
        attempts.push(`${host.replace('https://', '')}: InvalidHost`);
        continue; // 换下一个 key/host
      }
      if (data && data.error) {
        const e = data.error;
        const msg = `${e.title || 'QWeather 错误'}: ${e.detail || ''}`.trim();
        attempts.push(`${host.replace('https://', '')}: ${e.title}`);
        return { code: String(e.status || 'ERR'), message: msg };
      }
      if (data && data.code === '200') return data;
      // 非 200 且非 Invalid Host（如 404 路径错）：记录后继续尝试其它组合
      const c = data && data.code ? data.code : '?';
      console.warn(`[qweather] ${host} returned code ${c} (key ${key.slice(0, 6)}…)`);
      attempts.push(`${host.replace('https://', '')}: code=${c}`);
    }
  }
  return { code: 'ERR', message: 'all key/host combos failed [' + attempts.join(' | ') + ']' };
}

exports.main = async (event) => {
  try {
    return await realMain(event);
  } catch (e) {
    // 总兜底：确保永远返回可序列化的 {code,message}，不让平台包成 {error}
    const detail = (e && e.stack) ? e.stack : (e && e.message ? e.message : String(e));
    console.error('[qweather] uncaught in main:', detail);
    return { code: 'ERR', message: 'function crashed: ' + detail };
  }
};
