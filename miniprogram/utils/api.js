/**
 * 和风天气 API 封装
 * 文档: https://dev.qweather.com/docs/
 */

const app = getApp();

// GeoAPI（城市搜索）走云函数 /geo/ 前缀，由云函数转发到 geoapi.qweather.com，KEY 不在客户端

// —— 请求缓存：减少免费版每日配额消耗（默认 10 分钟 TTL）——
const CACHE_TTL = 10 * 60 * 1000;
const _requestCache = new Map();
function _cacheKey(host, path, params) {
  return `${host}${path}|${JSON.stringify(params)}`;
}
function _getCache(key, ttl) {
  const hit = _requestCache.get(key);
  // 优先用传入 ttl；否则用写入缓存时携带的 ttl；再否则默认 CACHE_TTL
  const eff = (ttl != null) ? ttl : (hit && hit.ttl != null ? hit.ttl : CACHE_TTL);
  if (hit && Date.now() - hit.time < eff) return hit.data;
  if (hit) _requestCache.delete(key);
  return null;
}
function _setCache(key, data, ttl = CACHE_TTL) {
  _requestCache.set(key, { time: Date.now(), data, ttl });
}

// 和风错误码 -> 友好提示（详见 https://dev.qweather.com/docs/resource/status-code/）
const QWEATHER_ERRORS = {
  '401': 'KEY 无效或错误',
  '402': 'KEY 已欠费或停用，请到和风控制台检查',
  '403': 'KEY 被封禁或无权限',
  '404': '未找到该城市的天气数据',
  '429': '请求过于频繁，请稍后再试',
  '500': '和风服务器异常，请稍后重试'
};

/**
 * 发起和风天气 API 请求（经微信云开发云函数 qweather 转发）
 * 说明：客户端不直接持有 KEY，由云函数在服务端注入并向和风请求。
 * wx.cloud.callFunction 走微信内网通道，无需配置 request 合法域名 / 备案域名。
 * @param {string} path API 路径，如 'v7/weather/now'、'geo/v2/city/lookup'
 * @param {object} params 查询参数
 */
const request = (path, params = {}) => {
  const key = `${path}|${JSON.stringify(params)}`;
  const cached = _getCache(key);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'qweather',
      data: { path, params },
      success: (res) => {
        const data = res.result;
        if (data && data.code === '200') {
          _setCache(key, data);
          resolve(data);
        } else if (data) {
          // 腾讯云函数平台级错误信封：函数抛异常时 res.result = { error: { errorMessage, ... } }
          // 把它翻译成可读错误，而不是落到“无 code 字段”的笼统提示
          if (data.error) {
            const msg = (data.error.errorMessage || JSON.stringify(data.error) || '未知云函数错误').slice(0, 240);
            console.error('云函数平台级错误:', data.error);
            reject(new Error('云函数运行异常: ' + msg));
            return;
          }
          // 识别“云函数把入参 event 原样回传”的情况（微信默认模板会 return {event,...}）：
          // 典型特征是有 tcbContext / userInfo / params 字段，且没有 code 字段。
          const echoedEvent = data.tcbContext !== undefined || (data.params && data.path && !data.code);
          if (echoedEvent) {
            console.error('云函数返回了入参 event（疑似部署的是微信默认模板，而非代理代码）:', data);
            reject(new Error('云函数返回的是入参而非天气数据：请确认云端部署的是 cloudfunctions/qweather/index.js 代理代码，而非默认模板'));
            return;
          }
          // 和风业务错误码 / 云函数自身 ERR / 其它非正常结构：一律按错误抛，
          // 避免把不含 now/daily 的残缺对象 resolve 出去导致下游 .icon 崩溃
          console.error('API 非正常返回:', path, params, data);
          const friendly = data.message
            || (data.code && QWEATHER_ERRORS[data.code])
            || `接口返回异常(${data.code ? 'code=' + data.code : '无 code 字段'})`;
          reject(new Error(friendly));
        } else {
          reject(new Error('云函数返回为空：请确认云函数 qweather 已上传部署、环境 ID 正确且已生效'));
        }
      },
      fail: (err) => {
        console.error('云函数调用失败:', err);
        reject(new Error('云函数调用失败，请确认已在开发者工具开通云开发环境并上传 qweather 云函数'));
      }
    });
  });
};

/**
 * 城市搜索 - 根据关键词搜索城市
 */
const searchCity = (keyword) => {
  // 走代理 /geo/ 前缀（代理据此转发到 geoapi.qweather.com）
  return request('/geo/v2/city/lookup', {
    location: keyword,
    number: 10,
    lang: 'zh'
  });
};

/**
 * 城市搜索 - 根据经纬度反查
 */
const searchCityByLocation = (lat, lon) => {
  return request('/geo/v2/city/lookup', {
    location: `${lon},${lat}`,
    number: 1,
    lang: 'zh'
  });
};

/**
 * 获取实时天气
 * @param {string} locationId 城市 LocationID，如 '101010100'
 */
const getWeatherNow = (locationId) => {
  return request('/v7/weather/now', {
    location: locationId,
    lang: 'zh'
  });
};

/**
 * 获取7天天气预报
 * @param {string} locationId 城市 LocationID
 */
const getWeather7d = (locationId) => {
  return request('/v7/weather/7d', {
    location: locationId,
    lang: 'zh'
  });
};

/**
 * 获取24小时逐时天气预报
 * @param {string} locationId 城市 LocationID
 */
const getWeather24h = (locationId) => {
  return request('/v7/weather/24h', {
    location: locationId,
    lang: 'zh'
  });
};

/**
 * 获取生活指数（可选功能）
 * @param {string} locationId 城市 LocationID
 * @param {string} type 指数类型，'0'=全部
 */
const getIndices = (locationId, type = '0') => {
  return request('/v7/indices/1d', {
    location: locationId,
    type: type,
    lang: 'zh'
  });
};

/**
 * 获取实时空气质量（AQI / PM2.5 / PM10 等）
 * @param {string} locationId 城市 LocationID
 */
const getAirNow = (locationId) => {
  return request('/v7/air/now', {
    location: locationId,
    lang: 'zh'
  });
};

/**
 * 获取分钟级降水（未来 2 小时，每 5 分钟一个点，中国区）
 * 注意：该接口只接受「经度,纬度」坐标，不接受城市 LocationID（否则返回 400 Invalid parameter）
 * @param {number|string} lon 经度
 * @param {number|string} lat 纬度
 */
const getMinutely5m = (lon, lat) => {
  return request('/v7/minutely/5m', {
    location: `${lon},${lat}`,
    lang: 'zh'
  });
};

/**
 * 获取实时天气预警（大风/暴雨/高温等，免费接口）
 * @param {string} locationId 城市 LocationID
 */
const getWarningNow = (locationId) => {
  return request('/v7/warning/now', {
    location: locationId,
    lang: 'zh'
  });
};

/**
 * 通过经纬度获取潮汐数据 —— 改用 Open-Meteo Marine API
 * 优点：免费、无需 key、全球任意坐标覆盖（不依赖和风潮汐站，解决了上海/天津等站无数据的问题）
 * 返回逐小时海平面高度（含潮汐信号），高/低潮由 tide.js 本地 extractExtremes 提取。
 * @param {number} lat 纬度
 * @param {number} lon 经度
 * @param {string} date 日期 yyyyMMdd
 * @returns {Promise<{times:string[], heights:(number|null)[]}>}
 */
const MARINE_HOST = 'https://marine-api.open-meteo.com';

// 单次 Open-Meteo 海洋请求（返回 {times, heights, utcOffsetSeconds}），失败 reject
// utcOffsetSeconds：站点时区相对 UTC 的偏移（Open-Meteo timezone=auto 返回），供前端换算“当地当前小时”
function requestMarine(lat, lon, start, end) {
  const url = `${MARINE_HOST}/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&hourly=sea_level_height_msl&timezone=auto&start_date=${start}&end_date=${end}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.hourly) {
          resolve({
            times: res.data.hourly.time || [],
            heights: res.data.hourly.sea_level_height_msl || [],
            utcOffsetSeconds: res.data.utc_offset_seconds
          });
        } else {
          const reason = (res.data && res.data.reason) || `HTTP ${res.statusCode}`;
          console.error('Open-Meteo 潮汐请求失败:', reason);
          reject(new Error(`潮汐数据请求失败: ${reason}`));
        }
      },
      fail: (err) => {
        console.error('Open-Meteo 网络请求失败:', err);
        // 微信小程序在域名未加入 request 合法域名白名单时，会直接 fail（请求根本不发往服务器）。
        // 明确提示域名配置，避免误以为是本地网络问题。
        reject(new Error('潮汐数据源(marine-api.open-meteo.com)请求被拒：请确认已配置该域名，或开发者工具已勾选"不校验合法域名"'));
      }
    });
  });
}

// 有效潮高点判定：Open-Meteo 在陆地网格点返回全 null，只有海洋网格点才有数值
function _hasTide(r) {
  return !!(r && r.heights && r.heights.some(h => h !== null && h !== undefined && !isNaN(h)));
}

/**
 * 按坐标拉取潮汐（海平面高度）。
 * 关键容错：给定坐标若在陆地网格上无数据（内陆/定位失败 fallback 到内陆城市等），
 * 自动螺旋搜索最近的有数据海岸点（snap），使潮汐始终能显示“距离定位最近的监测点”，
 * 而非直接报错“无潮汐数据”。吸附成功后回传 { snapped:true, usedLat, usedLon }。
 * @param {number|string} lat
 * @param {number|string} lon
 * @param {string} date 本周一 anchor（yyyyMMdd），一次拉整周 ±1 天窗口
 * @returns {Promise<{times:string[], heights:(number|null)[], snapped?:boolean, usedLat?:number, usedLon?:number}>}
 */
const getTideByCoord = async (lat, lon, date) => {
  // 数值范围校验：防异常/越界坐标直传第三方；合法纬度[-90,90]、经度[-180,180]
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    throw new Error('潮汐坐标超出合法范围，已拒绝请求');
  }
  // date 约定为“本周一”(anchor)：一次拉取整周 ±1 天缓冲窗口（共 9 天），覆盖整周并留边界余量，
  // 由调用方按具体日期切片。缓存 key 基于 anchor，使同周内任意日期只发一次请求，显著省配额。
  const y = +date.slice(0, 4);
  const m = +date.slice(4, 6);
  const d = +date.slice(6, 8);
  const base = new Date(y, m - 1, d);
  const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  // 周一-1（上周日）到 周一+7（下周一）：9 天窗口，含整周且让周界高低潮成为内部点
  const prev = new Date(base); prev.setDate(base.getDate() - 1);
  const next = new Date(base); next.setDate(base.getDate() + 7);
  const start = fmt(prev);
  const end = fmt(next);

  const tideKey = `tide:${la},${lo}:${date}`;
  const tideCached = _getCache(tideKey);
  if (tideCached) return tideCached;

  // 1) 主坐标请求
  const main = await requestMarine(la, lo, start, end).catch(() => null);
  if (main && _hasTide(main)) {
    const ok = { ...main, usedLat: la, usedLon: lo };
    _setCache(tideKey, ok);
    return ok;
  }

  // 2) 海岸吸附：螺旋搜索最近的有数据海岸点（内陆坐标自动吸附到最近海岸）
  //    步长由小到大、8 方向同层并行请求（串行最坏 32 次会等太久）；命中即返回。
  //    沿海/近内陆用户通常 1~2 层内命中。
  const steps = [0.5, 1.0, 2.0, 3.0];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const step of steps) {
    const candidates = dirs
      .map(([dx, dy]) => ({
        la: +(la + dy * step).toFixed(3),
        lo: +(lo + dx * step).toFixed(3)
      }))
      .filter(c => c.la >= -90 && c.la <= 90 && c.lo >= -180 && c.lo <= 180);
    const results = await Promise.all(
      candidates.map(c => requestMarine(c.la, c.lo, start, end).then(r => (r && _hasTide(r)) ? { ...r, usedLat: c.la, usedLon: c.lo, snapped: true } : null).catch(() => null))
    );
    const hit = results.find(Boolean);
    if (hit) {
      _setCache(tideKey, hit);
      return hit;
    }
  }

  // 3) 极深内陆实在找不到海岸点：返回主结果（可能无数据），由调用方提示“无潮汐数据”
  return { ...(main || { times: [], heights: [] }), usedLat: la, usedLon: lo };
};

/**
 * 台风数据 —— 经微信云开发云函数 typhoon 转发「中央气象台（NMC）」免费接口（无需 key）
 * 与 qweather 同理：wx.cloud.callFunction 走微信内网，无需配置 request 合法域名。
 * @param {string} action 'list' | 'detail'
 * @param {string|number} id 台风 id（detail 时必填）
 */
const callTyphoon = (action, id) => {
  const key = `typhoon|${action}|${id || ''}`;
  const cached = _getCache(key, 300000); // 5 分钟缓存，避免频繁打 NMC
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'typhoon',
      data: { action, id },
      success: (res) => {
        const data = res.result;
        if (data && data.code === 'OK') {
          _setCache(key, data, 300000);
          resolve(data);
        } else if (data && data.error) {
          const msg = (data.error.errorMessage || JSON.stringify(data.error) || '未知云函数错误').slice(0, 240);
          console.error('台风云函数平台级错误:', data.error);
          reject(new Error('台风云函数运行异常: ' + msg));
        } else if (data && data.tcbContext !== undefined) {
          reject(new Error('台风云函数返回的是入参而非数据：请确认云端部署的是 cloudfunctions/typhoon/index.js 代理代码，而非默认模板'));
        } else if (data) {
          console.error('台风 API 非正常返回:', data);
          reject(new Error(data.message || `台风接口返回异常(${data.code || '无 code'})`));
        } else {
          reject(new Error('台风云函数返回为空：请确认云函数 typhoon 已上传部署、环境 ID 正确且已生效'));
        }
      },
      fail: (err) => {
        console.error('台风云函数调用失败:', err);
        reject(new Error('台风云函数调用失败，请确认已开通云开发并上传 typhoon 云函数'));
      }
    });
  });
};

const getTyphoonList = () => callTyphoon('list');
const getTyphoonDetail = (id) => callTyphoon('detail', id);

module.exports = {
  searchCity,
  searchCityByLocation,
  getWeatherNow,
  getWeather7d,
  getWeather24h,
  getIndices,
  getAirNow,
  getWarningNow,
  getMinutely5m,
  getTideByCoord,
  getTyphoonList,
  getTyphoonDetail
};
