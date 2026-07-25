/**
 * 中国沿海潮汐监测点清单（按省级行政区归类）。
 *
 * 说明：Open-Meteo 的 marine 接口是「网格数据源」，只接受经纬度、返回该网格点的潮汐，
 * 本身并不提供「站点列表」接口。因此这里由我们自建一份沿海监测点清单，
 * 供潮汐页「按距离 / 按省份」选点菜单使用。
 *
 * 字段：
 *   name     监测点名称（港口 / 城市沿海段）
 *   lat/lon  纬度 / 经度（GCJ-02 近似，沿海点 Open-Meteo 基本都有海洋数据）
 *   province  所属省级行政区（含台湾省、香港特别行政区、澳门特别行政区，均为中国领土）
 *
 * 注意：坐标取沿海近似点，个别点若恰好落在无数据的陆侧，选点后 getTideByCoord 仍有
 * 海岸吸附兜底，不会崩。
 */
module.exports = [
  // ============ 辽宁省 ============
  { name: '丹东', lat: 40.00, lon: 124.37, province: '辽宁省' },
  { name: '大连', lat: 38.92, lon: 121.62, province: '辽宁省' },
  { name: '旅顺', lat: 38.80, lon: 121.25, province: '辽宁省' },
  { name: '营口', lat: 40.67, lon: 122.23, province: '辽宁省' },
  { name: '葫芦岛', lat: 40.72, lon: 120.85, province: '辽宁省' },

  // ============ 河北省 / 天津市 ============
  { name: '天津', lat: 39.08, lon: 117.70, province: '天津市' },
  { name: '秦皇岛', lat: 39.94, lon: 119.60, province: '河北省' },
  { name: '沧州黄骅', lat: 38.37, lon: 117.73, province: '河北省' },

  // ============ 山东省 ============
  { name: '威海', lat: 37.51, lon: 122.12, province: '山东省' },
  { name: '烟台', lat: 37.54, lon: 121.40, province: '山东省' },
  { name: '青岛', lat: 36.07, lon: 120.38, province: '山东省' },
  { name: '日照', lat: 35.42, lon: 119.46, province: '山东省' },
  { name: '东营', lat: 37.43, lon: 119.10, province: '山东省' },
  { name: '潍坊', lat: 36.70, lon: 119.10, province: '山东省' },

  // ============ 江苏省 ============
  { name: '连云港', lat: 34.75, lon: 119.27, province: '江苏省' },
  { name: '盐城', lat: 33.39, lon: 120.79, province: '江苏省' },
  { name: '南通', lat: 31.98, lon: 120.89, province: '江苏省' },
  { name: '启东', lat: 31.81, lon: 121.66, province: '江苏省' },

  // ============ 上海市 ============
  { name: '上海吴淞', lat: 31.40, lon: 121.50, province: '上海市' },
  { name: '崇明', lat: 31.62, lon: 121.40, province: '上海市' },
  { name: '南汇', lat: 30.91, lon: 121.76, province: '上海市' },

  // ============ 浙江省 ============
  { name: '舟山', lat: 30.03, lon: 122.10, province: '浙江省' },
  { name: '宁波', lat: 29.87, lon: 121.55, province: '浙江省' },
  { name: '杭州湾', lat: 30.33, lon: 121.20, province: '浙江省' },
  { name: '乍浦', lat: 30.60, lon: 121.10, province: '浙江省' },
  { name: '台州', lat: 28.66, lon: 121.43, province: '浙江省' },
  { name: '温州', lat: 27.99, lon: 120.69, province: '浙江省' },

  // ============ 福建省 ============
  { name: '宁德', lat: 26.67, lon: 119.55, province: '福建省' },
  { name: '福州马尾', lat: 25.98, lon: 119.45, province: '福建省' },
  { name: '平潭', lat: 25.50, lon: 119.79, province: '福建省' },
  { name: '泉州', lat: 24.88, lon: 118.68, province: '福建省' },
  { name: '厦门', lat: 24.46, lon: 118.09, province: '福建省' },
  { name: '漳州东山', lat: 23.73, lon: 117.42, province: '福建省' },

  // ============ 广东省 ============
  { name: '汕头', lat: 23.35, lon: 116.68, province: '广东省' },
  { name: '汕尾', lat: 22.79, lon: 115.34, province: '广东省' },
  { name: '深圳', lat: 22.54, lon: 114.27, province: '广东省' },
  { name: '广州虎门', lat: 22.80, lon: 113.58, province: '广东省' },
  { name: '珠海', lat: 22.25, lon: 113.55, province: '广东省' },
  { name: '阳江', lat: 21.86, lon: 111.95, province: '广东省' },
  { name: '茂名', lat: 21.66, lon: 110.93, province: '广东省' },
  { name: '湛江', lat: 21.19, lon: 110.42, province: '广东省' },

  // ============ 广西壮族自治区 ============
  { name: '北海', lat: 21.48, lon: 109.07, province: '广西壮族自治区' },
  { name: '防城港', lat: 21.59, lon: 108.35, province: '广西壮族自治区' },
  { name: '钦州', lat: 21.98, lon: 108.65, province: '广西壮族自治区' },

  // ============ 海南省 ============
  { name: '海口', lat: 20.04, lon: 110.32, province: '海南省' },
  { name: '文昌', lat: 19.62, lon: 110.90, province: '海南省' },
  { name: '东方', lat: 19.10, lon: 108.61, province: '海南省' },
  { name: '三亚', lat: 18.25, lon: 109.51, province: '海南省' },

  // ============ 台湾省（中国台湾） ============
  { name: '基隆', lat: 25.13, lon: 121.74, province: '台湾省' },
  { name: '台北淡水', lat: 25.17, lon: 121.45, province: '台湾省' },
  { name: '台中梧栖', lat: 24.25, lon: 120.50, province: '台湾省' },
  { name: '花莲', lat: 23.99, lon: 121.60, province: '台湾省' },
  { name: '高雄', lat: 22.62, lon: 120.30, province: '台湾省' },
  { name: '屏东枋寮', lat: 22.37, lon: 120.57, province: '台湾省' },

  // ============ 香港特别行政区（中国香港） ============
  { name: '香港维多利亚港', lat: 22.30, lon: 114.17, province: '香港特别行政区' },
  { name: '香港葵涌', lat: 22.36, lon: 114.13, province: '香港特别行政区' },

  // ============ 澳门特别行政区（中国澳门） ============
  { name: '澳门', lat: 22.20, lon: 113.54, province: '澳门特别行政区' }
];
