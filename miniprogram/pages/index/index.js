// pages/index/index.js
const api = require('../../utils/api');
const util = require('../../utils/util');

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

// 风圈半径格式化：r7/r10/r12 各取 四向（东北/东南/西南/西北）km
function formatRadii(r) {
  if (!r) return '—';
  const order = [['r7', '7级'], ['r10', '10级'], ['r12', '12级']];
  const parts = [];
  order.forEach(([k, label]) => {
    const v = r[k];
    if (v && v.ne != null) parts.push(`${label} ${v.ne}/${v.se}/${v.sw}/${v.nw} km`);
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
    city: { name: '北京', id: '101010100', lat: 39.9042, lon: 116.4074 },
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
    // 全天逐时天气弹层
    showHourlySheet: false,
    hourlyLoading: false,
    hourly: [],
    hourlyCityId: '',
    // 空气质量 + 分钟级降水
    air: null,
    minutely: null,
    // 台风板块（数据来自中央气象台 NMC，经 typhoon 云函数代理）
    typhoonCollapsed: false,
    typhoons: [],
    typhoonActiveCount: 0,  // 本年活跃台风数
    typhoonTotal: 0,        // 本年台风总数
    typhoonLoading: false,
    typhoonOpenId: '',      // 当前展开详情的台风 id
    typhoonMap: null,       // 当前展开台风的地图/详情数据
    typhoonDetails: {}      // id -> 完整详情（缓存，避免重复拉取）
  },

  onLoad() {
    this._inited = false; // 初始化期间由 initPage 负责首次加载，避免与 onShow 重复 fetch
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
    this.setData({ loading: true, error: false, air: null, minutely: null });
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

      this.setData({
        now: {
          temp: now.temp,
          feelsLike: now.feelsLike,
          weatherText: weatherInfo.text,
          weatherIcon: weatherInfo.icon,
          effectType,
          humidity: now.humidity,
          windDir: now.windDir,
          windScale: now.windScale,
          windSpeed: now.windSpeed,
          vis: now.vis,
          pressure: now.pressure,
          precip: now.precip
        },
        particles: buildParticles(effectType),
        clouds: (effectType === 'cloud' || effectType === 'fog') ? buildClouds() : [],
        heroTextClass: isLight ? 'hero-dark' : 'hero-light',
        daily: (dailyData.daily || []).map(d => ({
          ...d,
          weekDay: util.getWeekDay(d.fxDate),
          iconDay: util.getWeatherIcon(d.iconDay).icon
        })),
        indices: (indicesData.daily || []).map(i => ({
          name: i.name,
          category: i.category,
          type: i.type
        })),
        updateTime: nowData.updateTime,
        loading: false
      });

      // 空气质量 + 分钟级降水：独立抓取，失败不影响主页面
      this.fetchAir(id);
      this.fetchMinutely(id);
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
      this.setData({
        typhoons: list,
        typhoonActiveCount: res.activeCount || 0,
        typhoonTotal: res.total || 0,
        typhoonLoading: false,
        // 卡片始终展开显示（无活跃台风时展示历史列表）
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

  // 点击实时天气区 -> 打开全天逐时天气弹层
  async openHourlyDetail() {
    if (this.data.showHourlySheet) return;
    // 已加载且城市未变则直接展示，避免重复请求
    if (this.data.hourly.length > 0 && this.data.hourlyCityId === this.data.city.id) {
      this.setData({ showHourlySheet: true });
      return;
    }
    this.setData({ showHourlySheet: true, hourlyLoading: true });
    try {
      const res = await api.getWeather24h(this.data.city.id);
      const nowHour = new Date().getHours(); // 设备本地小时，避免 iOS Date 解析坑
      const mapped = (res.hourly || []).map(h => {
        const m = h.fxTime.match(/T(\d{2}):(\d{2})/);
        const hour = m ? Number(m[1]) : -1;
        const info = util.getWeatherIcon(h.icon);
        return {
          fxTime: h.fxTime,
          hour,
          temp: h.temp,
          icon: info.iconDark,
          text: info.text,
          pop: Number(h.pop || 0),
          windDir: h.windDir,
          windScale: h.windScale
        };
      });

      // 以当前时间为起点，顺序往下排到当天 24 时（23:00）为止；
      // 跨入第二天的条目（小时数回绕）不纳入，避免 “00:00/01:00” 排在 23:00 之后造成顺序错乱
      let startIdx = mapped.findIndex(x => x.hour >= nowHour);
      if (startIdx < 0) startIdx = 0;
      const rest = mapped.slice(startIdx);
      const todayPart = [];
      let prevHour = -1;
      for (const x of rest) {
        if (x.hour < prevHour) break; // 小时数回绕，说明已跨到第二天，停止
        todayPart.push(x);
        prevHour = x.hour;
      }
      const hourly = todayPart.map((x, i) => ({
        ...x,
        isNow: i === 0,
        timeStr: i === 0 ? '现在' : `${x.hour}:00`
      }));
      this.setData({ hourly, hourlyCityId: this.data.city.id, hourlyLoading: false });
    } catch (err) {
      console.error('获取逐时天气失败:', err);
      this.setData({ hourlyLoading: false });
      wx.showToast({ title: '获取逐时天气失败', icon: 'none' });
    }
  },

  closeHourlySheet() {
    this.setData({ showHourlySheet: false });
  },

  // 阻止冒泡：点击面板内部不关闭弹层
  noBubble() {}
});
