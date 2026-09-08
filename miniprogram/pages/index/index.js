// pages/index/index.js
const api = require('../../utils/api');
const util = require('../../utils/util');

// ===== 图表布局常量（px）=====
// 24h 图表：固定列宽 58px，横向滚动；7d 图表：按卡片内容宽 7 等分
const HOURLY_COL_W = 58;
const HOURLY_CHART_H = 82;
const DAILY_CHART_H = 100;

// 预警等级 -> 徽标配色（蓝/黄/橙/红）
const WARNING_LEVEL_COLORS = {
  '蓝': '#1677FF',
  '黄': '#FAAD14',
  '橙': '#FA8C16',
  '红': '#F5222D'
};

// 生活指数类型与图标映射
const INDEX_ICONS = {
  '运动指数': '🏃',
  '洗车指数': '🚗',
  '穿衣指数': '👔',
  '紫外线指数': '☀️',
  '舒适度指数': '🛋️',
  '感冒指数': '💊',
  '空气污染扩散条件指数': '🍃',
  '空调开启指数': '❄️',
  '过敏指数': '🌸',
  '钓鱼指数': '🎣',
  '雨伞指数': '☂️',
  '交通指数': '🚦',
  '防晒指数': '🧴',
  '旅游指数': '✈️',
  '晾晒指数': '👕'
};

// 平滑曲线：相邻点中点作控制点的三次贝塞尔（天气类温度曲线通用画法）
function traceSmoothCurve(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i];
    const mx = (p.x + c.x) / 2;
    ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
  }
}

// 由 fxTime 的时区偏移（如 "2026-09-04T10:00+08:00" 的 +08:00）算出该城市“现在”的当地小时，
// 用于和 fxTime 中的当地小时比较；解析失败回退设备本地小时（国内场景两者一致）。
function localHourFromFxTime(fxTime) {
  const fallback = new Date().getHours();
  if (!fxTime || typeof fxTime !== 'string') return fallback;
  const m = fxTime.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return fallback;
  const offsetMin = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === '-' ? -1 : 1);
  const now = new Date(); // 设备本地时间 -> UTC -> 城市当地时间
  const local = new Date(now.getTime() + (now.getTimezoneOffset() + offsetMin) * 60000);
  return local.getHours();
}

// 根据天气文字返回对应动效类型
function getWeatherEffect(text) {
  if (!text) return '';
  if (/雷/.test(text)) return 'thunder';
  if (/雨/.test(text)) return 'rain';
  if (/雪/.test(text)) return 'snow';
  if (/雾|霾/.test(text)) return 'fog';
  if (/云|阴/.test(text)) return 'cloud';
  if (/晴/.test(text)) return 'sun';
  return 'cloud';
}

// AQI 等级 -> 配色（参考国标空气质量分色，且保证文字/底色对比度 ≥ 4.5:1）
// 浅底（优绿/良黄/轻度橙）配深色字；深底（中红/紫/褐/灰）配白字
function aqiColor(level) {
  switch (Number(level)) {
    case 1: return { bg: '#52C41A', fg: '#06370E' }; // 优：绿底深绿字
    case 2: return { bg: '#FAAD14', fg: '#533F04' }; // 良：黄底深褐字
    case 3: return { bg: '#FA8C16', fg: '#5C2E00' }; // 轻度污染：橙底深褐字
    case 4: return { bg: '#CF1322', fg: '#FFFFFF' }; // 中度污染：深红底白字
    case 5: return { bg: '#9C27B0', fg: '#FFFFFF' }; // 重度污染：紫底白字
    case 6: return { bg: '#7E0023', fg: '#FFFFFF' }; // 严重污染：褐红底白字
    default: return { bg: '#595959', fg: '#FFFFFF' }; // 未知：深灰底白字
  }
}

// 生成雨/雪粒子（全屏随机分布，避免大量 nth-child 规则）
function buildParticles(type) {
  const isSnow = type === 'snow';
  const n = isSnow ? 46 : 52;
  const arr = [];
  for (let i = 0; i < n; i++) {
    const left = (Math.random() * 100).toFixed(2);
    const dur = isSnow
      ? (3 + Math.random() * 3).toFixed(2)
      : (0.45 + Math.random() * 0.5).toFixed(2);
    const delay = (Math.random() * (isSnow ? 4 : 1.2)).toFixed(2);
    if (isSnow) {
      const size = (6 + Math.random() * 9).toFixed(0); // 6~15rpx
      arr.push({ id: i, style: `left:${left}%; width:${size}rpx; height:${size}rpx; animation-duration:${dur}s; animation-delay:-${delay}s;` });
    } else {
      const size = (16 + Math.random() * 22).toFixed(0); // 16~38rpx 高度
      arr.push({ style: `left:${left}%; height:${size}rpx; animation-duration:${dur}s; animation-delay:-${delay}s;` });
    }
  }
  return arr;
}

// 生成云层（全屏随机分布）
function buildClouds() {
  const n = 6;
  const arr = [];
  for (let i = 0; i < n; i++) {
    const top = (6 + Math.random() * 72).toFixed(1); // 6%~78%
    const w = (150 + Math.random() * 150).toFixed(0); // 150~300rpx
    const h = (w * 0.42).toFixed(0);
    const dur = (16 + Math.random() * 22).toFixed(1);
    const delay = (-Math.random() * 30).toFixed(1);
    arr.push({ id: i, style: `top:${top}%; width:${w}rpx; height:${h}rpx; animation-duration:${dur}s; animation-delay:${delay}s;` });
  }
  return arr;
}

// 天文信息计算：日照时长（HH小时MM分）、日照占比、月相表情、月出月落指示
// 和风 7d 接口 moonPhase 为中文（如「新月」「上弦月」「满月」「残月」等），常见值见下表
const MOON_PHASE_EMOJI = {
  '新月': '🌑',
  '蛾眉月': '🌒',
  '上弦月': '🌓',
  '盈凸月': '🌔',
  '满月': '🌕',
  '亏凸月': '🌖',
  '下弦月': '🌗',
  '残月': '🌘'
};
function computeAstro(today) {
  const out = {
    daylightText: '--',
    daylightPercent: 50,
    moonPhaseEmoji: '🌘',
    moonPhaseText: '--',
    moonriseIcon: '🌙',
    moonsetIcon: '🌑'
  };
  if (!today) return out;
  // 日照时长
  if (today.sunrise && today.sunset) {
    const [sh, sm] = String(today.sunrise).split(':').map(Number);
    const [eh, em] = String(today.sunset).split(':').map(Number);
    if (sh != null && sm != null && eh != null && em != null) {
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60; // 跨午夜保护（极地）
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      out.daylightText = `${h}小时${String(m).padStart(2, '0')}分`;
      out.daylightPercent = Math.round((mins / (24 * 60)) * 100);
    }
  }
  // 月相表情 + 文案
  if (today.moonPhase) {
    const phase = String(today.moonPhase).trim();
    out.moonPhaseText = phase;
    out.moonPhaseEmoji = MOON_PHASE_EMOJI[phase] || '🌙';
  }
  // 月出月落箭头（粗略指示当前时刻相对于月出落的"上升/下落"状态）
  if (today.moonrise && today.moonset) {
    out.moonriseIcon = '🌙'; // 升起的月
    out.moonsetIcon = '🌑';  // 下落的月
  }
  return out;
}

// 风圈半径格式化：r7/r10/r12 各取 四向（东北/东南/西南/西北）km
function formatRadii(r) {
  if (!r) return '—';
  const order = [['r7', '7级'], ['r10', '10级'], ['r12', '12级']];
  const parts = [];
  order.forEach(([k, label]) => {
    const v = r[k];
    if (!v) return;
    // 各方向可能缺失（NMC 对远海台风常只给部分象限），缺失显示 —
    const fmt = (x) => (x != null && !isNaN(x) ? x : '—');
    if ([v.ne, v.se, v.sw, v.nw].some((x) => x != null)) {
      parts.push(`${label} ${fmt(v.ne)}/${fmt(v.se)}/${fmt(v.sw)}/${fmt(v.nw)} km`);
    }
  });
  return parts.length ? parts.join('  ') : '—';
}

// 由台风详情构造地图路径 + 详情展示数据
function buildTyphoonMap(detail) {
  const points = detail.points || [];
  const track = points.map(p => ({ latitude: p.lat, longitude: p.lon }));
  let forecast = [];
  const cur = points.length ? points[points.length - 1] : null;
  if (cur && cur.forecasts) {
    const agency = cur.forecasts.BABJ ? 'BABJ' : Object.keys(cur.forecasts)[0];
    if (agency) forecast = (cur.forecasts[agency] || []).map(f => ({ latitude: f.lat, longitude: f.lon }));
  }
  const center = track.length
    ? track[track.length - 1]
    : (forecast[0] || { latitude: 20, longitude: 130 });

  const polylines = [];
  if (track.length > 1) {
    polylines.push({ points: track, color: '#FF4D4F', width: 4, dottedLine: false, arrowLine: true, borderWidth: 1, borderColor: '#fff' });
  }
  if (forecast.length > 1) {
    polylines.push({ points: forecast, color: '#FFA940', width: 3, dottedLine: true });
  }
  const markers = cur
    ? [{
        id: 0,
        latitude: cur.lat,
        longitude: cur.lon,
        width: 22,
        height: 22,
        callout: { content: detail.name, color: '#fff', bgColor: '#FF4D4F', padding: 6, display: 'ALWAYS', textAlign: 'center' }
      }]
    : [];

  const recentPoints = points.slice(-8).reverse().map(p => ({
    time: String(p.time).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5'),
    grade: p.grade,
    gradeText: p.gradeText,
    lat: p.lat,
    lon: p.lon,
    windSpeed: p.windSpeed,
    pressure: p.pressure
  }));

  return {
    centerLat: center.latitude,
    centerLng: center.longitude,
    polylines,
    markers,
    radiiText: cur ? formatRadii(cur.radii) : '—',
    recentPoints,
    current: cur
      ? {
          lat: cur.lat,
          lon: cur.lon,
          windSpeed: cur.windSpeed,
          pressure: cur.pressure,
          gradeText: cur.gradeText,
          moveDirText: cur.moveDirText,
          moveSpeed: cur.moveSpeed
        }
      : null
  };
}

Page({
  data: {
    city: { name: '北京', id: '101010100', lat: 39.90499, lon: 116.40529 },
    now: null,
    daily: [],
    indices: [],
    loading: true,
    updateTime: '',
    error: false,
    errorMsg: '',
    particles: [],
    clouds: [],
    rays: [0, 1, 2, 3],
    heroTextClass: 'hero-light',
    // 气象预警徽标（无预警时为 null 隐藏）
    warning: null,
    // 天文信息（日照时长 / 月相表情 / 月出月落指示）
    astro: {},
    // 24小时预报图表（曲线 + 图标 + 风力条 + 时间）
    hourly: [],
    hourlyChart: { w: 0, h: HOURLY_CHART_H, img: '' },
    // 7天预报图表（双温度曲线）
    dailyChart: { w: 0, h: DAILY_CHART_H },
    dailyColW: 0,           // 7天图表单列宽（px）
    todayIdx: -1,           // “今天”列索引（整列高亮）
    todayColStyle: '',      // “今天”列精确高亮样式（left + width）
    typhoonNotice: '',      // hero 快讯卡：台风动态一句话
    // 空气质量 + 分钟级降水
    air: null,
    minutely: null,
    // 潮汐今日状态速报（级别 + 活汛/死汛）
    tideSummary: null,
    // 台风板块（数据来自中央气象台 NMC，经 typhoon 云函数代理）
    typhoonCollapsed: false,
    showHistoryTyphoons: false, // 无活跃台风时，控制是否展开历史档案抽屉
    typhoons: [],
    typhoonActiveCount: 0,  // 本年活跃台风数
    typhoonTotal: 0,        // 本年台风总数
    typhoonLoading: false,
    typhoonOpenId: '',      // 当前展开详情的台风 id
    typhoonMap: null,       // 当前展开台风的地图/详情数据
    typhoonDetails: {},     // id -> 完整详情（缓存，避免重复拉取）
    typhoonDisplay: []      // 实际展示列表：有活跃只显活跃，无活跃取最近 3 个
  },

  onLoad() {
    this._inited = false; // 初始化期间由 initPage 负责首次加载，避免与 onShow 重复 fetch
    // 屏宽与 7 天图表几何：卡片内容宽 = 屏宽 - 左右 margin/padding（共 100rpx）
    this._winWidth = 375;
    try { this._winWidth = wx.getWindowInfo().windowWidth || 375; } catch (e) { /* 兜底默认 */ }
    const contentW = Math.floor(this._winWidth * 650 / 750);
    this.setData({
      dailyColW: Math.floor(contentW / 7 * 10) / 10,
      dailyChart: { w: contentW, h: DAILY_CHART_H }
    });
    this.initPage();
  },

  onShow() {
    const app = getApp();
    const city = app.globalData.currentCity;
    // 首次未初始化完成时不重复加载（initPage 已会加载）；仅初始化后、城市确实变更才刷新
    if (!this._inited) return;
    if (city && city.id !== this.data.city.id) {
      this.setData({ city, loading: true });
      this.fetchAllData();
    }
  },

  onPullDownRefresh() {
    Promise.all([this.fetchAllData(), this.fetchTyphoons()]).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async initPage() {
    const app = getApp();
    let pos = null;
    // 1) 先定位（内部已含隐私授权）；只有定位本身失败才提示并回退默认城市
    try {
      pos = await app.getLocation();
      // 保存精确坐标，供潮汐按“距离定位最近的点”取数（而非区划中心）
      app.globalData.currentLocation = { lat: pos.lat, lon: pos.lon };
    } catch (err) {
      // 定位失败可能原因：
      // 1) 用户拒绝/未点同意隐私弹窗（privacy not authorized / errno 112）——后台《隐私保护指引》已发布的前提下，需用户在弹窗点“同意并继续”
      // 2) 用户拒绝定位授权（scope.userLocation）
      // 3) 系统/网络异常
      const errMsg = (err && err.errMsg) || '';
      let tip = '定位失败，已使用默认城市';
      if (/privacy|not authorized|112/.test(errMsg) || (err && err.errno === 112)) {
        // 后台已发布时，errno 112 多半是“用户没同意弹窗”，而非“后台没配置”
        tip = '请在弹窗中点“同意”以使用定位，已用默认城市';
      } else if (/auth|deny|scope/.test(errMsg)) {
        tip = '未授权定位，已使用默认城市';
      }
      console.log('定位失败，使用默认城市', err);
      wx.showToast({ title: tip, icon: 'none', duration: 2600 });
    }

    // 2) 定位成功后再反查城市；和风在海外/海上/偏远地区会返回 404（No Such Location），
    //    此时静默回退到已选/默认城市，不要误报“定位失败”
    if (pos) {
      try {
        const geoRes = await api.searchCityByLocation(pos.lat, pos.lon);
        if (geoRes.location && geoRes.location.length > 0) {
          const loc = geoRes.location[0];
          // 用更细的区/县名（如“黄浦”），而非上一级市名（如“上海”），缩小定位范围
          const city = {
            id: loc.id,
            name: util.cityDisplayName(loc),
            adm1: loc.adm1,
            adm2: loc.adm2,
            lat: Number(loc.lat),   // 和风返回字符串，统一转 number
            lon: Number(loc.lon)
          };
          app.globalData.currentCity = city;
          wx.setStorageSync('currentCity', city);
          this.setData({ city });
        }
      } catch (err) {
        console.log('当前坐标无对应城市，沿用已选城市', err);
      }
    }

    this.fetchAllData();
    this.fetchTyphoons();
    this._inited = true; // 标记初始化完成，后续 onShow 方可触发城市变更刷新
  },

  async fetchAllData() {
    this.setData({ loading: true, error: false, air: null, minutely: null, warning: null });
    const { id } = this.data.city;

    try {
      const [nowData, dailyData, indicesData] = await Promise.all([
        api.getWeatherNow(id),
        api.getWeather7d(id),
        api.getIndices(id, '0')
      ]);

      const now = nowData.now;
      const weatherInfo = util.getWeatherIcon(now.icon);
      const effectType = getWeatherEffect(weatherInfo.text);
      const isLight = (effectType === 'snow' || effectType === 'fog');

      // 7 天列表：补充图表所需字段（今天高亮 / MM/DD / 深色图标）
      const todayHyphen = util.formatDate(new Date());
      const dailyList = (dailyData.daily || []).map(d => ({
        ...d,
        weekDay: util.getWeekDay(d.fxDate),
        dateText: (d.fxDate || '').slice(5).replace('-', '/'),
        isToday: d.fxDate === todayHyphen,
        iconDay: util.getWeatherIcon(d.iconDay).icon,             // 白色版（hero 今日/明日条）
        iconDayDark: util.getWeatherIcon(d.iconDay).iconDark,      // 深色版（白底 7 天图表白天）
        iconNightDark: util.getWeatherIcon(d.iconNight).iconDark   // 深色版（白底 7 天图表夜间）
      }));

      // 天文信息：日照时长 + 月相表情 + 月出月落指示
      const today = dailyList[0] || {};
      const astro = computeAstro(today);

      this.setData({
        now: {
          temp: now.temp,
          feelsLike: now.feelsLike,
          weatherText: weatherInfo.text,
          weatherIcon: weatherInfo.icon,
          effectType,
          humidity: now.humidity,
          windDir: now.windDir || '',
          // 和风部分城市/无实况时 windScale 为 null/缺失，兜底为空字符串，渲染层统一显示"微风"
          windScale: (now.windScale != null && now.windScale !== '') ? now.windScale : '',
          windSpeed: now.windSpeed,
          vis: now.vis,
          pressure: now.pressure,
          precip: now.precip
        },
        particles: buildParticles(effectType),
        clouds: (effectType === 'cloud' || effectType === 'fog') ? buildClouds() : [],
        heroTextClass: isLight ? 'hero-dark' : 'hero-light',
        daily: dailyList,
        todayIdx: dailyList.findIndex(d => d.isToday),
        astro,
        indices: (indicesData.daily || []).map(i => {
          const shortName = i.name.replace(/指数$/, '');
          return {
            name: shortName,
            fullName: i.name,
            category: i.category,
            type: i.type,
            icon: INDEX_ICONS[i.name] || '💡'
          };
        }),
        tideSummary: util.calcTideStatus(new Date()),
        updateTime: util.formatUpdateTime(nowData.updateTime),
        loading: false
      });
      wx.nextTick(() => this.drawDailyCurves());

      // 副数据独立抓取，失败不影响主页面
      this.fetchAir(id);
      this.fetchMinutely(id);
      this.fetchWarning(id);
      this.fetchHourly(id);
    } catch (err) {
      console.error('获取天气数据失败:', err);
      const msg = (err && err.message) ? err.message : '获取天气失败';
      this.setData({ loading: false, error: true, errorMsg: msg });
    }
  },

  // 实时空气质量（best-effort，全球可用）
  async fetchAir(id) {
    try {
      const res = await api.getAirNow(id);
      const a = res.now;
      if (!a) return;
      const level = Number(a.level);
      this.setData({
        air: {
          aqi: a.aqi,
          category: a.category,
          primary: (a.primary && a.primary !== 'NA') ? a.primary : '无',
          pm25: a.pm2p5 || '—',
          pm10: a.pm10 || '—',
          color: aqiColor(level)
        }
      });
    } catch (err) {
      console.warn('获取空气质量失败（可能该地点不支持）:', err.message);
    }
  },

  // 分钟级降水（中国区；该接口只接受 经度,纬度 坐标，不接受城市ID）
  async fetchMinutely(id) {
    const { lon, lat } = this.data.city;
    // 优先用城市自带坐标；没有则通过 GeoAPI 反查（用城市ID查自身坐标）
    let coord = (lon && lat) ? { lon, lat } : null;
    if (!coord) {
      try {
        const geo = await api.searchCity(id);
        const loc = geo.location && geo.location[0];
        if (loc && loc.lon && loc.lat) coord = { lon: loc.lon, lat: loc.lat };
      } catch (e) { /* 查不到坐标就放弃该卡片 */ }
    }
    if (!coord) return;
    try {
      const res = await api.getMinutely5m(coord.lon, coord.lat);
      const list = res.minutely || [];
      if (list.length === 0) {
        this.setData({ minutely: { summary: res.summary || '暂无降水预报', bars: [] } });
        return;
      }
      const max = Math.max(0.1, ...list.map(x => Number(x.precip || 0)));
      const bars = list.map((x, i) => ({
        pct: Math.round((Number(x.precip || 0) / max) * 100),
        type: x.type,
        idx: i
      }));
      this.setData({ minutely: { summary: res.summary || '', bars } });
    } catch (err) {
      console.warn('获取分钟级降水失败:', err.message);
    }
  },

  // 台风板块：拉取台风列表（活跃 + 历史，best-effort，失败不影响主页面）
  async fetchTyphoons() {
    this.setData({ typhoonLoading: true });
    try {
      const res = await api.getTyphoonList();
      const list = (res.typhoons || []).map(t => ({ ...t, id: String(t.id) }));
      // 展示规则：有活跃台风只显活跃（state==='start'）；无活跃取最近 3 个（历史已按编号倒序）
      const actives = list.filter(t => t.state === 'start');
      const display = actives.length > 0 ? actives : list.slice(0, 3);
      // hero 快讯卡一句话：活跃台风播报编号+名字；无活跃取最近一个历史台风
      let typhoonNotice = '';
      if (display.length > 0) {
        const t0 = display[0];
        typhoonNotice = t0.state === 'start'
          ? `${t0.number}号台风“${t0.name}”活跃中，关注动态`
          : `台风“${t0.name}”已停编，查看近期动态`;
      }
      this.setData({
        typhoons: list,
        typhoonDisplay: display,
        typhoonNotice,
        typhoonActiveCount: res.activeCount || 0,
        typhoonTotal: res.total || 0,
        typhoonLoading: false,
        typhoonCollapsed: false,
        typhoonOpenId: '',
        typhoonMap: null
      });
    } catch (err) {
      console.warn('获取台风列表失败:', err.message);
      this.setData({ typhoonLoading: false });
    }
  },

  // 展开/收起整个台风板块
  toggleTyphoon() {
    this.setData({ typhoonCollapsed: !this.data.typhoonCollapsed });
  },

  // 展开/收起无台风时的历史档案抽屉
  toggleHistoryTyphoons() {
    this.setData({ showHistoryTyphoons: !this.data.showHistoryTyphoons });
  },

  // 点开某个台风的详情（首次展开时拉取完整路径）
  async toggleTyphoonDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.typhoonOpenId === String(id)) {
      this.setData({ typhoonOpenId: '', typhoonMap: null });
      return;
    }
    // 先拷贝再改，避免直接 mutate this.data（小程序 setData 前应保持数据不可变）
    const details = { ...this.data.typhoonDetails };
    if (!details[id]) {
      this.setData({ typhoonLoading: true });
      try {
        const res = await api.getTyphoonDetail(id);
        const detail = res.typhoon || {};
        details[id] = detail;
        this.setData({ typhoonDetails: details });
      } catch (err) {
        this.setData({ typhoonLoading: false });
        wx.showToast({ title: '台风详情获取失败', icon: 'none' });
        return;
      }
    }
    this.setData({
      typhoonOpenId: String(id),
      typhoonMap: buildTyphoonMap(details[id]),
      typhoonLoading: false
    });
  },

  // 重试：错误态下点击“重新加载”
  retryFetch() {
    this.fetchAllData();
  },

  goToSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goToTide() {
    wx.switchTab({ url: '/pages/tide/tide' });
  },

  // 气象预警（免费接口；无预警时徽标隐藏，失败静默）
  async fetchWarning(id) {
    try {
      const res = await api.getWarningNow(id);
      const w = res.warning && res.warning[0];
      if (!w) return;
      // 优先用 类型名+预警（如“大风预警”）做短标题，等级字取色（蓝黄橙红）
      const levelMatch = (w.level || '').match(/[蓝黄橙红]/);
      this.setData({
        warning: {
          title: w.typeName ? `${w.typeName}预警` : String(w.title || '气象预警').slice(0, 12),
          color: WARNING_LEVEL_COLORS[levelMatch ? levelMatch[0] : '橙']
        }
      });
    } catch (err) {
      console.warn('获取预警失败:', err.message);
    }
  },

  // 24小时逐时天气：首页图表直出（连续24小时全量时间流）
  async fetchHourly(id) {
    try {
      const res = await api.getWeather24h(id);
      const rawList = res.hourly || [];
      if (!rawList.length) return;

      let foundMidnight = false;
      let prevHour = -1;

      const hourly = rawList.map((h, i) => {
        const m = h.fxTime.match(/T(\d{2}):(\d{2})/);
        const hourNum = m ? Number(m[1]) : 0;
        const info = util.getWeatherIcon(h.icon);

        const rawScale = (h.windScale != null && String(h.windScale) !== '') ? String(h.windScale) : null;
        const realtimeScale = (this.data.now && this.data.now.windScale != null && String(this.data.now.windScale) !== '') ? String(this.data.now.windScale) : null;
        const dispScale = rawScale != null ? rawScale : realtimeScale;

        let isTmr = false;
        if (i > 0 && hourNum < prevHour && !foundMidnight) {
          foundMidnight = true;
          isTmr = true;
        }
        prevHour = hourNum;

        let timeStr = `${String(hourNum).padStart(2, '0')}:00`;
        if (i === 0) {
          timeStr = '现在';
        } else if (isTmr || (foundMidnight && hourNum === 0)) {
          timeStr = '次日';
        }

        return {
          fxTime: h.fxTime,
          hour: hourNum,
          temp: Number(h.temp),
          icon: info.iconDark,
          text: info.text,
          windScale: dispScale,
          isNow: i === 0,
          isTomorrow: isTmr || (foundMidnight && hourNum === 0),
          timeStr
        };
      });

      this.setData({
        hourly,
        hourlyChart: { w: hourly.length * HOURLY_COL_W, h: HOURLY_CHART_H, img: '' }
      });
      wx.nextTick(() => this.drawHourlyChart());
    } catch (err) {
      console.warn('获取逐时天气失败:', err.message);
    }
  },

  // ===== Canvas 图表绘制（canvas 2d 同层渲染）=====

  // 取 canvas 节点并按 dpr 初始化（dpr 上限 2，避免超长画布超出设备限制）
  // cb(ctx, width, height, node)：node 供 canvasToTempFilePath 导出图片用
  _setupCanvas(id, cb) {
    this.createSelectorQuery().select('#' + id).fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const { node, width, height } = res[0];
      if (!width || !height) return;
      const dpr = Math.min(wx.getWindowInfo ? (wx.getWindowInfo().pixelRatio || 2) : 2, 2);
      node.width = width * dpr;
      node.height = height * dpr;
      const ctx = node.getContext('2d');
      ctx.scale(dpr, dpr);
      cb(ctx, width, height, node);
    });
  },

  // 24h 温度曲线：渐变面积 + 平滑曲线 + 严谨节点标注
  drawHourlyChart() {
    const list = this.data.hourly;
    if (!list.length) return;
    this._setupCanvas('hourlyCanvas', (ctx, w, h, node) => {
      ctx.clearRect(0, 0, w, h);

      const temps = list.map(x => x.temp);
      let max = Math.max(...temps), min = Math.min(...temps);
      if (max === min) { max += 1; min -= 1; }

      // 纵向留白：顶部 20px 留给温度数字，底部 14px
      const padT = 20, padB = 14;
      const drawH = h - padT - padB;
      const pts = temps.map((t, i) => ({
        x: i * HOURLY_COL_W + HOURLY_COL_W / 2,
        y: padT + (max - t) / (max - min) * drawH
      }));

      // 1. 曲线下方柔和海蓝渐变面积
      const grad = ctx.createLinearGradient(0, padT, 0, h);
      grad.addColorStop(0, 'rgba(22, 119, 255, 0.22)');
      grad.addColorStop(1, 'rgba(22, 119, 255, 0.01)');
      ctx.beginPath();
      traceSmoothCurve(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, h);
      ctx.lineTo(pts[0].x, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // 2. 曲线描边
      ctx.beginPath();
      traceSmoothCurve(ctx, pts);
      ctx.strokeStyle = '#1677FF';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // 3. 温度标注与当前点发光圆环
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (i === 0) {
          // 当前时间点发光呼吸锚点
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(22, 119, 255, 0.25)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#1677FF';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#1677FF';
          ctx.fillText(`${temps[i]}°`, p.x, p.y - 12);
        } else {
          // 普通节点
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#91CAFF';
          ctx.fill();

          ctx.fillStyle = '#4A4A4A';
          ctx.fillText(`${temps[i]}°`, p.x, p.y - 11);
        }
      }

      // 导出为临时图片供 <image> 展示
      wx.canvasToTempFilePath({
        canvas: node,
        destWidth: node.width,
        destHeight: node.height,
        success: (res) => this.setData({ 'hourlyChart.img': res.tempFilePath }),
        fail: (e) => console.warn('24小时曲线图导出失败:', e && e.errMsg)
      });
    });
  },

  // 7天双温度曲线：高精度 DOM 像素中心对齐 + 双曲线区间温差填色 + 清空画布防重影
  drawDailyCurves() {
    const daily = this.data.daily;
    if (!daily || daily.length < 2) return;

    // 测量 .daily-wrap 与所有 7 个 .fc-col 的实际像素位置，实现 100% 严丝合缝像素级对齐
    this.createSelectorQuery()
      .select('.daily-wrap')
      .boundingClientRect()
      .selectAll('.fc-col')
      .boundingClientRect()
      .exec((res) => {
        if (!res || !res[0] || !res[1] || res[1].length === 0) return;
        const wrapRect = res[0];
        const colRects = res[1];
        const realW = Math.round(wrapRect.width);

        // 提取每列在画布内的绝对水平中心坐标
        const colXs = colRects.slice(0, daily.length).map(r => Math.round(r.left - wrapRect.left + r.width / 2));

        // 今天所在列的高亮背景位置与宽度精确同步
        const todayIdx = this.data.todayIdx;
        let todayStyle = '';
        if (todayIdx >= 0 && colRects[todayIdx]) {
          const tRect = colRects[todayIdx];
          const tLeft = Math.round(tRect.left - wrapRect.left);
          const tWidth = Math.round(tRect.width);
          todayStyle = `left:${tLeft}px;width:${tWidth}px;`;
        }

        this.setData({
          'dailyChart.w': realW,
          todayColStyle: todayStyle
        }, () => {
          this._setupCanvas('dailyCanvas', (ctx, w, h) => {
            // 绘制前清空画布，彻底解决重影浮动
            ctx.clearRect(0, 0, w, h);

            const maxVals = daily.map(d => Number(d.tempMax));
            const minVals = daily.map(d => Number(d.tempMin));
            const allVals = [...maxVals, ...minVals];
            let gMax = Math.max(...allVals);
            let gMin = Math.min(...allVals);
            if (gMax === gMin) { gMax += 1; gMin -= 1; }

            // 纵向留白：顶部 24px 留给最高温标注，底部 24px 留给最低温标注
            const padT = 24, padB = 24;
            const drawH = h - padT - padB;

            const highPts = maxVals.map((v, i) => ({
              x: colXs[i] !== undefined ? colXs[i] : Math.round(w / daily.length * i + w / daily.length / 2),
              y: padT + (gMax - v) / (gMax - gMin) * drawH,
              v
            }));

            const lowPts = minVals.map((v, i) => ({
              x: colXs[i] !== undefined ? colXs[i] : Math.round(w / daily.length * i + w / daily.length / 2),
              y: padT + (gMax - v) / (gMax - gMin) * drawH,
              v
            }));

            // 1. 高低温之间的昼夜温差带透明填充
            const areaGrad = ctx.createLinearGradient(0, padT, 0, h - padB);
            areaGrad.addColorStop(0, 'rgba(255, 177, 77, 0.16)');
            areaGrad.addColorStop(1, 'rgba(99, 168, 255, 0.08)');
            ctx.beginPath();
            traceSmoothCurve(ctx, highPts);
            for (let i = lowPts.length - 1; i >= 0; i--) {
              if (i === lowPts.length - 1) {
                ctx.lineTo(lowPts[i].x, lowPts[i].y);
              } else {
                const prev = lowPts[i + 1], curr = lowPts[i];
                const mx = (prev.x + curr.x) / 2;
                ctx.bezierCurveTo(mx, prev.y, mx, curr.y, curr.x, curr.y);
              }
            }
            ctx.closePath();
            ctx.fillStyle = areaGrad;
            ctx.fill();

            // 2. 双平滑曲线绘制（高温橙、低温蓝）
            const series = [
              { pts: highPts, line: '#FFA940', dot: '#FF9C3F', labelDy: -11, textColor: '#D46B08' },
              { pts: lowPts, line: '#69B1FF', dot: '#1677FF', labelDy: 17, textColor: '#0958D9' }
            ];

            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const s of series) {
              ctx.beginPath();
              traceSmoothCurve(ctx, s.pts);
              ctx.strokeStyle = s.line;
              ctx.lineWidth = 2.2;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.stroke();

              s.pts.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = s.dot;
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#FFFFFF';
                ctx.stroke();

                ctx.fillStyle = s.textColor;
                ctx.fillText(`${p.v}°`, p.x, p.y + s.labelDy);
              });
            }
          });
        });
      });
  },

  // hero 快讯卡 / 徽标点击 -> 平滑滚动到对应板块
  scrollToSection(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.pageScrollTo({ selector: '#' + id, duration: 300, fail: () => {} });
  }
});
