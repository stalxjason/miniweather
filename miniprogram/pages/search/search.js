// pages/search/search.js
const api = require('../../utils/api');
const util = require('../../utils/util');

const HOT_CITIES = [
  { id: '101010100', name: '北京', lat: 39.90499, lon: 116.40529 },
  { id: '101020100', name: '上海', lat: 31.23037, lon: 121.47370 },
  { id: '101280101', name: '广州', lat: 23.12916, lon: 113.26443 },
  { id: '101280601', name: '深圳', lat: 22.54310, lon: 114.05787 },
  { id: '101210101', name: '杭州', lat: 30.28746, lon: 120.15358 },
  { id: '101190401', name: '苏州', lat: 31.29897, lon: 120.58532 },
  { id: '101270101', name: '成都', lat: 30.57281, lon: 104.06680 },
  { id: '101200101', name: '武汉', lat: 30.59285, lon: 114.30554 },
  { id: '101110101', name: '西安', lat: 34.34157, lon: 108.94017 },
  { id: '101230101', name: '福州', lat: 26.07530, lon: 119.30624 },
  { id: '101120201', name: '青岛', lat: 36.06711, lon: 120.38261 },
  { id: '101070201', name: '大连', lat: 38.91400, lon: 121.61468 }
];

Page({
  data: {
    keyword: '',
    results: [],
    hotCities: HOT_CITIES,
    searching: false,
    statusBarHeight: 0,
    navBarHeight: 44,
    navRight: 100
  },

  onLoad() {
    const winInfo = wx.getWindowInfo();
    let statusBarHeight = winInfo.statusBarHeight || 0;
    let navBarHeight = 44; // 默认值（部分机型取不到胶囊时使用）
    let navRight = 100;    // 默认值（预留给微信胶囊的右侧净宽）

    try {
      const menuBtn = wx.getMenuButtonBoundingClientRect();
      if (menuBtn && typeof menuBtn.top === 'number') {
        // 胶囊上下空隙对称，反推出标准导航栏内容高度
        navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height;
        // 胶囊右侧占用空间 = 屏宽 - 胶囊左边界，再留 8px 间距避免紧贴
        const windowWidth = winInfo.windowWidth || 375;
        navRight = windowWidth - menuBtn.left + 8;
      }
    } catch (e) {
      // getMenuButtonBoundingClientRect 不兼容时退回默认
    }

    this.setData({ statusBarHeight, navBarHeight, navRight });
  },

  onInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });

    if (keyword.trim().length > 0) {
      this.doSearch(keyword.trim());
    } else {
      this.setData({ results: [] });
    }
  },

  onSearch(e) {
    const keyword = e.detail.value.trim();
    if (keyword) {
      this.doSearch(keyword);
    }
  },

  async doSearch(keyword) {
    this.setData({ searching: true });
    try {
      const res = await api.searchCity(keyword);
      this.setData({
        results: res.location || [],
        searching: false
      });
    } catch (err) {
      console.error('搜索城市失败:', err);
      this.setData({ searching: false });
    }
  },

  selectCity(e) {
    const city = this.data.results[e.currentTarget.dataset.index];
    this.saveAndGoBack(city);
  },

  selectHotCity(e) {
    // wxml data-* 属性值一律字符串，这里统一转 number（约定 lat/lon 为 number）
    const { id, name } = e.currentTarget.dataset;
    const lat = Number(e.currentTarget.dataset.lat);
    const lon = Number(e.currentTarget.dataset.lon);
    this.saveAndGoBack({ id, name, lat, lon });
  },

  async locateCity() {
    wx.showLoading({ title: '定位中...' });
    const app = getApp();

    // 1) 先定位（内部已含隐私授权）；只有定位本身失败才提示“定位失败”
    let pos;
    try {
      pos = await app.getLocation();
    } catch (err) {
      wx.hideLoading();
      const errMsg = (err && err.errMsg) || '';
      if (err && err.errno === 112) {
        wx.showToast({ title: '请在小程序后台「隐私保护指引」开启位置信息', icon: 'none' });
      } else if (/privacy/.test(errMsg)) {
        wx.showToast({ title: '请先同意隐私协议以使用定位', icon: 'none' });
      } else {
        wx.showToast({ title: '定位失败，请检查定位权限', icon: 'none' });
      }
      return;
    }

    // 2) 用坐标反查城市；和风在海外/海上/偏远地区会返回 404（No Such Location）。
    //    反查失败时不再报错崩溃，改用“当前坐标”兜底（和风天气接口支持经纬度直查）。
    try {
      const geoRes = await api.searchCityByLocation(pos.lat, pos.lon);
      if (geoRes.location && geoRes.location.length > 0) {
        const loc = geoRes.location[0];
        const city = {
          id: loc.id,
          name: util.cityDisplayName(loc),
          lat: Number(loc.lat),
          lon: Number(loc.lon)
        };
        wx.hideLoading();
        this.saveAndGoBack(city);
        return;
      }
      throw new Error('No Such Location');
    } catch (err) {
      wx.hideLoading();
      // 反查无城市：以当前坐标作为城市（name 显示“当前位置”），同时保留精确坐标供潮汐使用
      const fallback = {
        id: `${pos.lon},${pos.lat}`,
        name: '当前位置',
        lat: pos.lat,
        lon: pos.lon
      };
      app.globalData.currentLocation = { lat: pos.lat, lon: pos.lon };
      this.saveAndGoBack(fallback);
      wx.showToast({ title: '该位置暂无城市数据，已按当前坐标显示', icon: 'none' });
    }
  },

  saveAndGoBack(city) {
    const app = getApp();
    app.globalData.currentCity = {
      id: city.id,
      name: city.name,
      lat: city.lat,
      lon: city.lon
    };
    wx.setStorageSync('currentCity', app.globalData.currentCity);
    wx.navigateBack();
  },

  clearInput() {
    this.setData({ keyword: '', results: [] });
  },

  goBack() {
    wx.navigateBack();
  }
});
