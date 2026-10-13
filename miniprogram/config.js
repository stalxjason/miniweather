/**
 * 小程序全局配置文件
 */
module.exports = {
  // 微信云开发环境 ID
  // 填入指定的环境 ID；若为空字符串或未配置，将回退使用 wx.cloud.DYNAMIC_CURRENT_ENV（当前运行环境）
  cloudEnv: 'cloud1-d3gvlu91fc41b9439',

  // 默认城市（冷启动/未授权定位时的回退配置）
  defaultCity: {
    id: '101010100',
    name: '北京',
    lat: 39.90499,
    lon: 116.40529
  }
};
