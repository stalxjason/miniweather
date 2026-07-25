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
      dates.push({
        date: date,
        displayDate: `${d.getMonth() + 1}/${d.getDate()}`,
        weekDay: i === 0 ? '今天' : (i === 1 ? '明天' : util.getWeekDay(util.formatDate(d)))
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

      // 计算图表数据（基于当天）
      const heights = tideHourly.map(h => h.height);
      const maxH = Math.max(...heights, 1);
      const minH = Math.min(...heights, 0);

      // Y轴标签
      const yLabels = [];
      for (let i = 4; i >= 0; i--) {
        const val = minH + (maxH - minH) * i / 4;
        yLabels.push(val.toFixed(1) + 'm');
      }

      // 找到满潮/干潮对应的小时
      const tideTypeMap = {};
      tideTable.forEach(t => {
        tideTypeMap[this.formatHour(t.fxTime)] = t.type;
      });

      // 当前时间标记：仅当选中日期为“今天”时，高亮对应小时柱并自动滚到该列
      const isNowDay = selectedDate === util.getTodayStr();
      const nowHour = isNowDay ? String(new Date().getHours()).padStart(2, '0') : '';

      const processedHourly = tideHourly.map(h => {
        const hour = this.formatHour(h.fxTime);
        return {
          ...h,
          hour,
          isNow: isNowDay && hour === nowHour,
          barHeight: ((h.height - minH) / (maxH - minH || 1)) * this.data.chartMaxHeight,
          barPercent: ((h.height - minH) / (maxH - minH || 1)) * 100,
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
        tideTable,
        tideHourly: processedHourly,
        yAxisLabels: yLabels,
        nowScrollId: isNowDay ? 'bar-' + nowHour : '',
        error: false,
        loading: false,
        tideSnapped: !!res.snapped,
        tideSnapName,
        tideSnapDist,
        // 顶部 station-name 同步为实际数据来源的海岸点名称，让用户一眼看到当前展示的是哪
        'location.name': (res.snapped && tideSnapName) ? tideSnapName : this.data.location.name
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
  }
});
