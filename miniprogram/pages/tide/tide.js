// pages/tide/tide.js
const api = require('../../utils/api');
const util = require('../../utils/util');
const tideStations = require('../../data/tideStations');

/**
 * 从潮高曲线提取满潮(H)/干潮(L)
 * 基于逐小时海平面高度（含潮汐信号）找局部极大/极小值。
 * @param {string[]} times  ISO 时间数组
 * @param {number[]} heights 潮高数组（米）
 * @returns {Array<{fxTime:string,type:string,height:string}>}
 */
/**
 * 把天气页定位结果转成潮汐地点格式 {name, lat, lon}
 * 优先用 app.globalData.currentLocation（定位得到的精确设备坐标，街道级），
 * 这样潮汐按“距离定位最近的点”取数；城市名仍用区划名展示。
 * currentCity.lat/lon 为字符串或区划中心，作为回退。
 */
function weatherCityToTide() {
  const app = getApp();
  const city = app.globalData.currentCity;
  if (!city) return null;
  const precise = app.globalData.currentLocation;
  const lat = Number(precise ? precise.lat : city.lat);
  const lon = Number(precise ? precise.lon : city.lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { name: city.name || '当前位置', lat, lon };
}

// 计算给定 yyyyMMdd 所在周的周一（anchor）：潮汐按整周窗口拉取，缓存 key 基于该 anchor，
// 使同周内任意日期只发一次请求。
function mondayOf(dateStr) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6), d = +dateStr.slice(6, 8);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diff = (day === 0) ? -6 : (1 - day); // 周日(0)→-6，其它→1-day
  dt.setDate(dt.getDate() + diff);
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
}

function extractExtremes(times, heights) {
  const result = [];
  const n = heights.length;
  const eps = 0.005; // 米（5mm），过滤采样噪声；远小于真实潮汐振幅，既能抓浅低潮又不误判
  // 仅从曲线内部判定局部极大(满潮)/极小(干潮)，端点不自动算极值
  for (let i = 1; i < n - 1; i++) {
    const h = heights[i];
    const prev = heights[i - 1];
    const next = heights[i + 1];
    if (h - prev > eps && h - next > eps) {
      result.push({ fxTime: times[i], type: 'H', height: h.toFixed(2) });
    } else if (prev - h > eps && next - h > eps) {
      result.push({ fxTime: times[i], type: 'L', height: h.toFixed(2) });
    }
  }
  return result;
}

// 平滑曲线：相邻点中点作控制点的三次贝塞尔
function traceSmoothCurve(ctx, pts) {
  if (!pts || pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i];
    const mx = (p.x + c.x) / 2;
    ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
  }
}

// 绘制圆角矩形（用于“现在”标签气泡）
function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// 两坐标间距离（haversine，单位 km）—— 用于「按距离选海岸监测点」
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半径 km
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 距离文本：<100km 显示「x km」，否则「x.x km」
function fmtDist(km) {
  if (!isFinite(km)) return '';
  return km < 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

// 基于用户基准坐标，构建选点菜单数据：
//  - nearest：全部监测点按距离升序的前 N 个（菜单最顶部「离您最近」）
//  - provinces：按省份分组，省份按「该省最近点距离」升序，组内按距离升序
// @param {{lat:number,lon:number}} base 基准坐标（用户定位或当前潮汐地点）
function buildStationPicker(base) {
  const lat0 = Number(base.lat), lon0 = Number(base.lon);
  const withDist = tideStations.map(s => {
    const d = haversine(lat0, lon0, s.lat, s.lon);
    return { name: s.name, lat: s.lat, lon: s.lon, province: s.province, distanceKm: d, distanceText: fmtDist(d) };
  });
  const nearest = withDist.slice().sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
  const map = {};
  withDist.forEach(s => {
    if (!map[s.province]) map[s.province] = [];
    map[s.province].push(s);
  });
  const provinces = Object.keys(map).map(p => {
    const list = map[p].slice().sort((a, b) => a.distanceKm - b.distanceKm);
    return { province: p, nearestKm: list[0].distanceKm, stations: list };
  }).sort((a, b) => a.nearestKm - b.nearestKm);
  return { nearest, provinces };
}

// 省份全称 → 索引简称（用于快速索引侧栏，取唯一单字避免重名）
const PROVINCE_SHORT = {
  '辽宁省': '辽',
  '天津市': '津',
  '河北省': '冀',
  '山东省': '鲁',
  '江苏省': '苏',
  '上海市': '沪',
  '浙江省': '浙',
  '福建省': '闽',
  '广东省': '粤',
  '广西壮族自治区': '桂',
  '海南省': '琼',
  '台湾省': '台',
  '香港特别行政区': '港',
  '澳门特别行政区': '澳'
};

Page({
  data: {
    location: { name: '天津', lat: 39.08, lon: 117.70 },
    dates: [],
    selectedDate: '',
    tideTable: [],
    tideHourly: [],
    yAxisLabels: [],
    chartWidth: 1152,
    chartHeight: 180,
    tideChartImg: '',
    chartScrollLeft: 0,
    isNowDay: false,
    activeTipTab: 'ganhai',   // Tips 当前激活的选项卡: 'ganhai' | 'chaoxi' | 'haidiao'
    chartMaxHeight: 300,
    nowScrollId: '',
    loading: true,
    error: false,
    errorMsg: '',
    tideSnapped: false,      // 当前坐标无潮汐数据时，是否自动吸附到最近海岸监测点
    tideSnapName: '',        // 吸附到的海岸监测点名称（反查得到，失败时用坐标兜底）
    tideSnapDist: '',        // 原定位点 → 吸附点的直线距离文本（如「约 38 km」）
    showSearch: false,
    searchKeyword: '',
    searchResults: [],
    // 选点弹层（最近 + 按省份二级展开）
    stationPickerShow: false,
    nearestStations: [],     // 离用户最近的若干监测点（按距离升序）
    provinceGroups: [],      // 按省份分组，每组含 stations（含距离）
    expandedProvince: '',    // 当前展开的省份名（'' 表示全部折叠，全国地区默认不展开）
    provinceIndex: [],       // 快速索引：[{label, province}]，按当前排序的省份顺序生成
    provinceScrollTo: '',    // 索引点击后 scroll-view 滚动定位的目标 id
    // 当前潮汐地点是否为“跟随天气城市”（用户未在潮汐页单独设置时为 true）
    locationFromWeather: false
  },

  onLoad() {
    const app = getApp();
    const saved = app.globalData.tideLocation; // 用户在潮汐页显式选过的地点
    const w = weatherCityToTide(); // 天气页已获取的精确定位
    let location, fromWeather;
    if (saved && typeof saved.lat === 'number') {
      location = saved;
      fromWeather = false;
    } else if (w) {
      location = w;
      fromWeather = true; // 默认跟随天气地点，省去一次 Geo 查询
    } else {
      location = this.data.location; // 兜底默认（天津）
      fromWeather = false;
    }
    this.setData({ location, locationFromWeather: fromWeather });
    this.generateDates();
  },

  onShow() {
    const app = getApp();
    const saved = app.globalData.tideLocation;
    const w = weatherCityToTide();

    // 优先用用户在潮汐页显式设置的地点；否则跟随天气城市
    let target = null;
    let fromWeather = false;
    if (saved && typeof saved.lat === 'number') {
      target = saved;
      fromWeather = false;
    } else if (w) {
      target = w;
      fromWeather = true;
    }
    if (!target) return;

    // 仅在地点（或“来源”从显式切换为跟随天气）发生变化时才重新拉取，避免无谓刷新
    if (target.lat !== this.data.location.lat ||
        target.lon !== this.data.location.lon ||
        fromWeather !== this.data.locationFromWeather) {
      this.setData({ location: target, locationFromWeather: fromWeather });
      this.fetchTideData();
    }
  },

  onHide() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },

  onUnload() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },

  generateDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const status = util.calcTideStatus(d);
      dates.push({
        date: date,
        displayDate: `${d.getMonth() + 1}/${d.getDate()}`,
        weekDay: i === 0 ? '今天' : (i === 1 ? '明天' : util.getWeekDay(util.formatDate(d))),
        tideLevel: status.tideLevel,
        tideXun: status.tideXun,
        tideText: status.tideText,
        tideClass: status.tideClass
      });
    }
    this.setData({
      dates: dates,
      selectedDate: dates[0].date
    });
    this.fetchTideData();
  },

  async fetchTideData() {
    this.setData({ loading: true, error: false });
    const { location, selectedDate } = this.data;

    try {
      // 传“本周一”anchor：一次拉整周窗口，同周切换日期命中缓存、不再重复请求
      const anchor = mondayOf(selectedDate);
      const res = await api.getTideByCoord(location.lat, location.lon, anchor);

      // 配对并过滤无效点（Open-Meteo 偶发 null）
      const pairs = [];
      for (let i = 0; i < res.times.length; i++) {
        const h = res.heights[i];
        if (h === null || h === undefined || isNaN(h)) continue;
        pairs.push({ time: res.times[i], height: parseFloat(h) });
      }
      if (pairs.length === 0) throw new Error('无潮汐数据');

      // 从 9 天连续数据中提取各日期的实际日潮差，并微调更新 dates 的潮汐状态
      const updatedDates = this.data.dates.map(item => {
        const pfx = `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`;
        const dayHs = pairs.filter(p => p.time.indexOf(pfx) === 0).map(p => p.height);
        let dRange = null;
        if (dayHs.length > 0) {
          dRange = Math.max(...dayHs) - Math.min(...dayHs);
        }
        const y = +item.date.slice(0, 4), m = +item.date.slice(4, 6), d = +item.date.slice(6, 8);
        const dt = new Date(y, m - 1, d);
        const status = util.calcTideStatus(dt, dRange);
        return {
          ...item,
          tideLevel: status.tideLevel,
          tideXun: status.tideXun,
          tideText: status.tideText,
          tideClass: status.tideClass
        };
      });

      // 选中日 yyyy-MM-dd 前缀：从 ±1 天缓冲数据中筛出当天的曲线与极值
      const dayPrefix = `${selectedDate.slice(0, 4)}-${selectedDate.slice(4, 6)}-${selectedDate.slice(6, 8)}`;

      // 极值基于完整缓冲窗口（含前后各一天）检测，避免凌晨/深夜的高低潮落在边界被漏检
      const allExtremes = extractExtremes(pairs.map(p => p.time), pairs.map(p => p.height));
      const tideTable = allExtremes
        .filter(e => e.fxTime.indexOf(dayPrefix) === 0)
        .map(e => ({ fxTime: e.fxTime, type: e.type, height: e.height, timeStr: this.formatTime(e.fxTime) }));

      // 图表只画当天 24 小时
      const dayPairs = pairs.filter(p => p.time.indexOf(dayPrefix) === 0);
      const tideHourly = dayPairs.map(p => ({ fxTime: p.time, height: p.height }));

      // 记录站点时区偏移量，供绘制当前时间标识使用
      this._utcOffsetSeconds = res.utcOffsetSeconds || 0;

      // 计算图表数据（基于当天实际最高与最低潮位动态定标）
      const heights = tideHourly.map(h => h.height);
      let maxH = Math.max(...heights);
      let minH = Math.min(...heights);
      if (maxH === minH) {
        maxH += 0.5;
        minH -= 0.5;
      }
      const diff = maxH - minH;

      // Y轴标签（5个等分刻度）
      const yLabels = [];
      const prec = diff < 1.5 ? 2 : 1;
      for (let i = 4; i >= 0; i--) {
        const val = minH + diff * i / 4;
        yLabels.push(val.toFixed(prec) + 'm');
      }

      // 找到满潮/干潮对应的小时
      const tideTypeMap = {};
      tideTable.forEach(t => {
        tideTypeMap[this.formatHour(t.fxTime)] = t.type;
      });

      // 当前时间标记：仅当选中日期为“今天”时有效
      const isNowDay = selectedDate === util.getTodayStr();
      let nowHour = '';
      if (isNowDay) {
        const offMin = Math.round((res.utcOffsetSeconds || 0) / 60);
        const now = new Date();
        nowHour = String(new Date(now.getTime() + (now.getTimezoneOffset() + offMin) * 60000).getHours()).padStart(2, '0');
      }

      const processedHourly = tideHourly.map(h => {
        const hour = this.formatHour(h.fxTime);
        return {
          ...h,
          hour,
          isNow: isNowDay && hour === nowHour,
          barHeight: ((h.height - minH) / (diff || 1)) * 300,
          barPercent: ((h.height - minH) / (diff || 1)) * 100,
          type: tideTypeMap[hour] || ''
        };
      });

      // 若发生海岸吸附，反查吸附点地名用于展示（失败则用坐标兜底，不阻塞主流程）
      let tideSnapName = '';
      let tideSnapDist = '';
      if (res.snapped && typeof res.usedLat === 'number' && typeof res.usedLon === 'number') {
        try {
          const geo = await api.searchCityByLocation(res.usedLat, res.usedLon);
          if (geo && geo.location && geo.location.length > 0) {
            tideSnapName = util.cityDisplayName(geo.location[0]) || '';
          }
        } catch (e) {
          // 反查失败不影响主数据展示，下方用坐标兜底
        }
        if (!tideSnapName) {
          tideSnapName = `${res.usedLat.toFixed(2)}°N, ${res.usedLon.toFixed(2)}°E`;
        }

        // 计算原定位点 → 吸附点的直线距离，拼到提示文案
        if (tideSnapName) {
          const app = getApp();
          const base = app.globalData.currentLocation || this.data.location;
          const dKm = haversine(Number(base.lat), Number(base.lon), res.usedLat, res.usedLon);
          if (isFinite(dKm)) tideSnapDist = `约 ${fmtDist(dKm)}`;
        }
      }

      this.setData({
        dates: updatedDates,
        tideTable,
        tideHourly: processedHourly,
        yAxisLabels: yLabels,
        isNowDay,
        nowScrollId: isNowDay ? 'bar-' + nowHour : '',
        error: false,
        loading: false,
        tideSnapped: !!res.snapped,
        tideSnapName,
        tideSnapDist,
        // 顶部 station-name 同步为实际数据来源的海岸点名称，让用户一眼看到当前展示的是哪
        'location.name': (res.snapped && tideSnapName) ? tideSnapName : this.data.location.name
      }, () => {
        wx.nextTick(() => {
          this.drawTideChart();
        });
      });
    } catch (err) {
      console.error('获取潮汐数据失败:', err);
      // 把具体原因透出（如域名未配置），让用户一眼知道怎么修；真网络问题则显示原 message
      const msg = (err && err.message) ? err.message : '获取潮汐数据失败';
      const tip = msg.indexOf('域名') >= 0
        ? '潮汐数据源未配置合法域名：请在微信公众平台配置 marine-api.open-meteo.com，或在开发者工具勾选“不校验合法域名”'
        : msg;
      this.setData({
        loading: false,
        error: true,
        errorMsg: tip,
        tideTable: [],
        tideHourly: []
      });
    }
  },

  selectDate(e) {
    const date = e.currentTarget.dataset.date;
    this.setData({ selectedDate: date });
    this.fetchTideData();
  },

  // 重试：错误态下点击“重新加载”
  retryFetchTide() {
    this.fetchTideData();
  },

  // 打开选点弹层：先按用户基准坐标构建「最近 + 按省份」分组
  openStationPicker() {
    const app = getApp();
    const base = app.globalData.currentLocation || this.data.location;
    const { nearest, provinces } = buildStationPicker(base);
    // 快速索引：按当前省份排序生成「简称」列表（点击定位并展开对应省份）
    const provinceIndex = provinces.map(p => ({
      label: PROVINCE_SHORT[p.province] || p.province.slice(0, 1),
      province: p.province
    }));
    this.setData({
      stationPickerShow: true,
      nearestStations: nearest,
      provinceGroups: provinces,
      provinceIndex,
      expandedProvince: '',     // 全国地区默认不展开
      provinceScrollTo: '',
      showSearch: true,        // 弹层内搜索框默认可用（沿用现有搜索城市逻辑）
      searchKeyword: '',
      searchResults: []
    });
  },

  closeStationPicker() {
    this.setData({ stationPickerShow: false, showSearch: false, searchResults: [], searchKeyword: '' });
  },

  // 切换 Tips 选项卡（赶海 / 潮汐 / 海钓）
  switchTipTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.activeTipTab) {
      this.setData({ activeTipTab: tab });
    }
  },

  // 点击右侧快速索引：展开对应省份并滚动定位到该省份
  onIndexTap(e) {
    const province = e.currentTarget.dataset.province;
    const idx = this.data.provinceGroups.findIndex(g => g.province === province);
    if (idx < 0) return;
    this.setData({
      expandedProvince: province,
      provinceScrollTo: `prov-${idx}`
    });
  },

  // 省份折叠行：点击展开/收起
  toggleProvince(e) {
    const p = e.currentTarget.dataset.province;
    this.setData({ expandedProvince: this.data.expandedProvince === p ? '' : p });
  },

  // 从预置监测点中选中一个点（精确海岸点，通常无需再吸附）
  selectStation(e) {
    const { name, lat, lon } = e.currentTarget.dataset;
    const location = { name, lat: Number(lat), lon: Number(lon) };
    const app = getApp();
    app.globalData.tideLocation = location;
    wx.setStorageSync('tideLocation', location);
    this.setData({
      location,
      locationFromWeather: false,
      stationPickerShow: false,
      showSearch: false,
      searchResults: [],
      searchKeyword: ''
    });
    this.fetchTideData();
  },

  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ searchKeyword: keyword });
    if (!keyword) {
      this.setData({ searchResults: [] });
      return;
    }
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(async () => {
      try {
        const res = await api.searchCity(keyword);
        const list = (res.location || []).map(l => ({
          name: l.name,
          adm: l.adm1 ? `${l.adm1}${l.adm2 ? ' ' + l.adm2 : ''}` : '',
          lat: parseFloat(l.lat),
          lon: parseFloat(l.lon)
        }));
        this.setData({ searchResults: list });
      } catch (err) {
        this.setData({ searchResults: [] });
      }
    }, 300);
  },

  selectLocation(e) {
    const idx = e.currentTarget.dataset.index;
    const loc = this.data.searchResults[idx];
    if (!loc) return;
    const location = { name: loc.name, lat: loc.lat, lon: loc.lon };
    const app = getApp();
    app.globalData.tideLocation = location;
    wx.setStorageSync('tideLocation', location);
    this.setData({
      location,
      locationFromWeather: false, // 用户显式选择，不再跟随天气城市
      stationPickerShow: false,
      showSearch: false,
      searchResults: [],
      searchKeyword: ''
    });
    this.fetchTideData();
  },

  formatTime(isoStr) {
    const d = util.parseTime(isoStr);
    if (!d) return isoStr;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  formatHour(isoStr) {
    const d = util.parseTime(isoStr);
    if (!d) return '--';
    return String(d.getHours()).padStart(2, '0');
  },

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

  drawTideChart() {
    const list = this.data.tideHourly;
    if (!list || !list.length) return;

    this._setupCanvas('tideCanvas', (ctx, w, h, node) => {
      const heights = list.map(x => x.height);
      let maxH = Math.max(...heights);
      let minH = Math.min(...heights);
      if (maxH === minH) {
        maxH += 0.5;
        minH -= 0.5;
      }
      const diff = maxH - minH;

      const padT = 36;
      const padB = 32;
      const padL = 24;
      const padR = 24;
      const colW = 48;
      const drawH = h - padT - padB;

      // 1. 生成 24 个整点小时节点
      const pts = list.map((item, i) => {
        const x = padL + i * colW;
        const y = padT + ((maxH - item.height) / diff) * drawH;
        return {
          x,
          y,
          height: item.height,
          hour: item.hour,
          type: item.type
        };
      });

      // 2. 清空画布
      ctx.clearRect(0, 0, w, h);

      // 3. 绘制 5 条水平参考虚线
      for (let i = 0; i <= 4; i++) {
        const gy = padT + (drawH * i) / 4;
        ctx.beginPath();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.lineWidth = 1;
        ctx.moveTo(padL, gy);
        ctx.lineTo(w - padR, gy);
        ctx.stroke();
      }

      // X 轴基准线
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;
      ctx.moveTo(padL, h - padB);
      ctx.lineTo(w - padR, h - padB);
      ctx.stroke();

      // 4. 绘制渐变海蓝色填充区域
      const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
      grad.addColorStop(0, 'rgba(22, 119, 255, 0.28)');
      grad.addColorStop(0.5, 'rgba(22, 119, 255, 0.12)');
      grad.addColorStop(1, 'rgba(22, 119, 255, 0.02)');
      ctx.beginPath();
      traceSmoothCurve(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, h - padB);
      ctx.lineTo(pts[0].x, h - padB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // 5. 绘制平滑潮汐曲线
      ctx.beginPath();
      traceSmoothCurve(ctx, pts);
      ctx.strokeStyle = '#1677FF';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // 6. 绘制常规节点小圆点
      pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#91CAFF';
        ctx.fill();
      });

      // 7. 满潮 / 干潮极值点与文字标注
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      pts.forEach(p => {
        if (p.type === 'H') {
          // 满潮
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#1677FF';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.font = 'bold 10px sans-serif';
          ctx.fillStyle = '#1677FF';
          ctx.fillText(`满潮 ${p.height}m`, p.x, p.y - 12);
        } else if (p.type === 'L') {
          // 干潮
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#00A389';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.font = 'bold 10px sans-serif';
          ctx.fillStyle = '#00A389';
          ctx.fillText(`干潮 ${p.height}m`, p.x, p.y + 14);
        }
      });

      // 8. 标识当前时间（仅当天有效）
      const isNowDay = this.data.isNowDay;
      let nowX = -1;
      let nowHourStr = '';
      if (isNowDay) {
        const offMin = Math.round((this._utcOffsetSeconds || 0) / 60);
        const now = new Date();
        const stationNow = new Date(now.getTime() + (now.getTimezoneOffset() + offMin) * 60000);
        const curH = stationNow.getHours();
        const curM = stationNow.getMinutes();
        nowHourStr = String(curH).padStart(2, '0');

        const fracH = curH + curM / 60;
        if (fracH >= 0 && fracH <= 23) {
          nowX = padL + fracH * colW;
          const idx = Math.floor(fracH);
          const ratio = fracH - idx;
          const nextIdx = Math.min(idx + 1, 23);
          const nowY = pts[idx].y + (pts[nextIdx].y - pts[idx].y) * ratio;
          const curHeightVal = pts[idx].height + (pts[nextIdx].height - pts[idx].height) * ratio;

          // 绘制垂直指示虚线
          ctx.beginPath();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = '#FA8C16';
          ctx.lineWidth = 1.5;
          ctx.moveTo(nowX, padT - 18);
          ctx.lineTo(nowX, h - padB);
          ctx.stroke();
          ctx.setLineDash([]);

          // 绘制发光光晕与当前点
          ctx.beginPath();
          ctx.arc(nowX, nowY, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(250, 140, 22, 0.28)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(nowX, nowY, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#FA8C16';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // 绘制“现在”气泡标签
          const tagText = `现在 ${curHeightVal.toFixed(2)}m`;
          ctx.font = 'bold 10px sans-serif';
          const tw = ctx.measureText(tagText).width;
          const cw = tw + 12;
          const ch = 18;
          let cx = nowX - cw / 2;
          cx = Math.max(padL, Math.min(w - padR - cw, cx));
          let cy = nowY - 24;
          if (cy < padT - 18) cy = padT - 18;

          ctx.fillStyle = '#FA8C16';
          drawRoundRect(ctx, cx, cy, cw, ch, ch / 2);
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tagText, cx + cw / 2, cy + ch / 2);
        }
      }

      // 9. X 轴时间刻度标签（每小时一个节点）
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      pts.forEach(p => {
        const isCur = isNowDay && p.hour === nowHourStr;
        // 短刻度线
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = isCur ? '#FA8C16' : 'rgba(0, 0, 0, 0.15)';
        ctx.lineWidth = 1;
        ctx.moveTo(p.x, h - padB);
        ctx.lineTo(p.x, h - padB + 4);
        ctx.stroke();

        ctx.font = isCur ? 'bold 11px sans-serif' : '10px sans-serif';
        ctx.fillStyle = isCur ? '#FA8C16' : '#8C8C8C';
        ctx.fillText(p.hour + ':00', p.x, h - padB + 16);
      });

      // 10. 导出为临时图片供 <image> 展示
      wx.canvasToTempFilePath({
        canvas: node,
        destWidth: node.width,
        destHeight: node.height,
        success: (res) => {
          let scrollLeft = 0;
          if (nowX >= 0) {
            const winW = wx.getWindowInfo ? (wx.getWindowInfo().windowWidth || 375) : 375;
            const viewW = winW - 70;
            scrollLeft = Math.max(0, Math.round(nowX - viewW / 2));
          }
          this.setData({
            tideChartImg: res.tempFilePath,
            chartScrollLeft: scrollLeft
          });
        },
        fail: (err) => {
          console.warn('潮汐曲线导出图片失败:', err && err.errMsg);
        }
      });
    });
  }
});
