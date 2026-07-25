// app.js
App({
  globalData: {
    // 和风天气通过微信云开发云函数（qweather）代理转发，KEY 只存云端环境变量，客户端零密钥。
    // 调用走 wx.cloud.callFunction 微信内网通道，无需 request 合法域名、无需域名备案。

    // 当前选中城市
    currentCity: {
      id: '101010100',     // 默认北京
      name: '北京',
      lat: 39.90499,       // 统一为 number（约定：lat/lon 一律 number，避免与定位结果字符串混杂）
      lon: 116.40529
    },

    // 定位得到的精确设备坐标（街道级），供潮汐按“距离定位最近的点”取数
    currentLocation: null,

    // 潮汐地点（用户在潮汐页显式选择后持久化；未选择时跟随天气城市）
    tideLocation: null,

    // 隐私协议授权状态：基础库隐私模式下，调用 getLocation 等隐私接口前必须先让用户同意
    privacyAuthorized: false,

    // 运行平台：ios / android / harmony / devtools / windows ...（基础库 3.7.0+ 支持 harmony，用于兼容判断）
    platform: ''
  },

  onLaunch() {
    // 初始化微信云开发（KEY 安全性由云函数保障）
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信开发者工具基础库到 2.2.3 以上');
    } else {
      wx.cloud.init({
        env: 'cloud1-d3gvlu91fc41b9439',
        traceUser: true
      });
    }

    // 平台检测：基础库 3.7.0+ 支持 HarmonyOS，用细分 API（getDeviceInfo）而非已弃用的 getSystemInfo
    this.detectPlatform();

    // 从本地存储恢复城市设置
    const city = wx.getStorageSync('currentCity');
    if (city) {
      this.globalData.currentCity = city;
    }
    // 恢复潮汐地点（用户在潮汐页显式选过的站点，重启后保留）
    const tideLocation = wx.getStorageSync('tideLocation');
    if (tideLocation && typeof tideLocation.lat === 'number') {
      this.globalData.tideLocation = tideLocation;
    }

    // 隐私授权弹窗由页面挂载的 <privacy-popup> 组件接管（wx.onNeedPrivacyAuthorization），
    // 这里不再手动处理，避免两套弹窗机制冲突。getLocation 只管调用，未授权时框架会回调组件弹窗。
  },

  // 平台检测：优先使用细分 API，避免 getSystemInfo 弃用告警；harmony 用于后续 HarmonyOS 兼容
  detectPlatform() {
    try {
      if (typeof wx.getDeviceInfo === 'function') {
        const device = wx.getDeviceInfo();
        if (device && device.platform) {
          this.globalData.platform = device.platform; // ios / android / harmony / windows / mac / devtools
          return;
        }
      }
      // 旧基础库兜底（getSystemInfoSync 会触发弃用告警，仅老库兜底使用）
      if (typeof wx.getSystemInfoSync === 'function') {
        this.globalData.platform = wx.getSystemInfoSync().platform || '';
      }
    } catch (e) {
      // 平台仅用于兼容判断，忽略异常
    }
  },

  // 获取定位（隐私授权交由页面 <privacy-popup> 组件通过 wx.onNeedPrivacyAuthorization 接管；
  // 这里只管调用，未授权时框架会回调组件弹出授权窗，用户同意则自动重试本接口）
  async getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          resolve({
            lat: res.latitude,
            lon: res.longitude
          });
        },
        fail: (err) => {
          console.warn('定位失败（可能未同意隐私授权或被拒绝）', err);
          reject(err);
        }
      });
    });
  }
});
