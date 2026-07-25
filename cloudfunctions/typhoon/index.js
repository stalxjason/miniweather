// 台风云函数：代理「中央气象台（NMC）台风网」免费接口，无需任何 key。
// 数据源：https://typhoon.nmc.cn （权威、免费、覆盖西北太平洋与南海）
// 接口为 JSONP（callback 包裹）+ 数组下标结构，这里统一剥壳并映射为清晰命名 JSON。
//
// 动作（event.action）：
//   'list'   -> 返回当年“全部”台风（活跃 + 历史），按活跃在前排序；
//               活跃台风附最新位置/强度/趋势；并给出 activeCount / total。
//               前端据此在无活跃台风时仍可展示历史台风列表。
//   'detail' -> 传入 event.id，返回该台风完整路径（实况点 + 各机构预报）+ 风圈
//
// 注意：本函数不抛异常，一律返回 {code, ...} 信封，避免小程序侧收到 {error} 崩溃。

const https = require('https');

// ===== 强度等级 / 移向 中文映射 =====
const GRADE_MAP = {
  TD: '热带低压',
  TS: '热带风暴',
  STS: '强热带风暴',
  TY: '台风',
  STY: '强台风',
  SuperTY: '超强台风'
};
const DIR_MAP = {
  N: '北', S: '南', E: '东', W: '西',
  NW: '西北', NE: '东北', SW: '西南', SE: '东南',
  WNW: '西北西', ENE: '东北东', WSW: '西南西', ESE: '东南东',
  NNW: '北西北', NNE: '北东北', SSW: '南西南', SSE: '南东南'
};

// ===== 简单内存缓存（5 分钟） =====
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 50) cache.clear();
  return v;
}

// ===== 抓取 NMC（JSONP） =====
function stripJsonp(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('无法解析 JSONP 响应');
  return JSON.parse(text.slice(s, e + 1));
}

function doRequest(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; miniprogram-typhoon-proxy)',
          'Accept-Encoding': 'identity' // 不压缩，避免处理 gzip
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(stripJsonp(raw));
          } catch (err) {
            reject(new Error('解析失败: ' + err.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('请求超时')));
  });
}

const ts = () => Date.now();
const LIST_URL = `https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default?t=${ts()}&callback=typhoon_jsons_list_default`;
const viewUrl = (id) => `https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${id}?t=${ts()}&callback=typhoon_jsons_view_${id}`;

async function getList() {
  return cached('nmc_list', 300000, async () => {
    const j = await doRequest(LIST_URL);
    return (j && j.typhoonList) || [];
  });
}

async function getView(id) {
  return cached('nmc_view_' + id, 300000, async () => {
    const j = await doRequest(viewUrl(id));
    // 空数组视为未找到（否则 main 中 `if(!t)` 不拦截，会返回空详情）
    return (j && j.typhoon && j.typhoon.length) ? j.typhoon : null;
  });
}

// ===== 解析 =====
// 风圈：item = ["30KTS", ne, se, sw, nw, pointId]（30KTS=7级，50KTS=10级，64KTS=12级）
function parseRadii(arr) {
  const r = { r7: null, r10: null, r12: null };
  (arr || []).forEach((item) => {
    if (!item || !item[0]) return;
    const g = item[0];
    const vals = { ne: Number(item[1]), se: Number(item[2]), sw: Number(item[3]), nw: Number(item[4]) };
    if (g === '30KTS') r.r7 = vals;
    else if (g === '50KTS') r.r10 = vals;
    else if (g === '64KTS') r.r12 = vals;
  });
  return r;
}

// 单点（points 数组元素）映射为命名对象
function parsePoint(p) {
  if (!p) return null;
  const grade = p[3];
  const moveDir = p[8];
  const forecasts = parseForecasts(p[11]);
  return {
    time: p[1],
    timestamp: p[2],
    grade,
    gradeText: GRADE_MAP[grade] || grade,
    lon: Number(p[4]),
    lat: Number(p[5]),
    pressure: Number(p[6]),
    windSpeed: Number(p[7]),
    moveDir,
    moveDirText: DIR_MAP[moveDir] || moveDir,
    moveSpeed: Number(p[9]),
    radii: parseRadii(p[10]),
    forecasts
  };
}

// 预报：{ BABJ: [[leadTime, timeStr, lon, lat, pressure, windSpeed, agency, grade], ...] }
function parseForecasts(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  Object.keys(obj).forEach((agency) => {
    const arr = obj[agency] || [];
    out[agency] = arr.map((f) => ({
      leadTime: Number(f[0]),
      timeStr: f[1],
      lon: Number(f[2]),
      lat: Number(f[3]),
      pressure: Number(f[4]),
      windSpeed: Number(f[5]),
      agency: f[6],
      grade: f[7]
    }));
  });
  return out;
}

// 摘要：列表用，取最新实况点
function buildSummary(t) {
  if (!t) return null;
  const points = (t[8] || []).map(parsePoint).filter(Boolean);
  const current = points.length ? points[points.length - 1] : null;
  const trend = current
    ? `向${current.moveDirText}方向移动，风速 ${current.windSpeed} m/s，中心气压 ${current.pressure} hPa`
    : '';
  return {
    id: t[0],
    name: t[2],
    enName: t[1],
    number: t[3],
    state: t[7],
    current,
    trend
  };
}

// 详情：完整路径 + 预报 + 风圈
function buildDetail(t) {
  if (!t) return null;
  const points = (t[8] || []).map(parsePoint).filter(Boolean);
  const current = points.length ? points[points.length - 1] : null;
  const trend = current
    ? `向${current.moveDirText}方向移动，风速 ${current.windSpeed} m/s，中心气压 ${current.pressure} hPa`
    : '';
  return {
    id: t[0],
    name: t[2],
    enName: t[1],
    number: t[3],
    state: t[7],
    points,
    current,
    trend
  };
}

// ===== 入口 =====
exports.main = async (event) => {
  try {
    const action = event && event.action;

    if (action === 'detail') {
      const id = event.id;
      if (!id) return { code: 'ERR', message: '缺少台风 id' };
      // id 字符白名单：NMC 台风编号为纯数字，防路径/参数注入
      if (!/^[0-9]+$/.test(String(id))) return { code: 'ERR', message: '非法的台风 id' };
      const t = await getView(id);
      if (!t) return { code: 'ERR', message: '未找到该台风数据' };
      return { code: 'OK', typhoon: buildDetail(t) };
    }

    // 默认：当年全部台风（活跃 + 历史）
    const list = await getList();
    const all = (list || []).map((t) => ({
      id: t[0],
      name: t[2],
      enName: t[1],
      number: t[3],
      state: t[7] || 'stop'
    }));
    const actives = all.filter((t) => t.state === 'start');
    // 仅对活跃台风拉详情取最新位置；历史台风列表项不拉，避免一次性大量请求
    const activeSummaries = await Promise.all(
      actives.map(async (t) => {
        try {
          const v = await getView(t.id);
          return buildSummary(v) || t;
        } catch (e) {
          return t;
        }
      })
    );
    const historical = all.filter((t) => t.state !== 'start');
    // 历史台风按编号倒序（最新生成的排前面）
    historical.sort((a, b) => String(b.number).localeCompare(String(a.number)));
    return {
      code: 'OK',
      typhoons: [...activeSummaries, ...historical],
      activeCount: actives.length,
      total: all.length
    };
  } catch (e) {
    return { code: 'ERR', message: e.message || '台风数据获取失败' };
  }
};
