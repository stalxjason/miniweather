/**
 * 通用工具函数
 */

/**
 * 格式化日期
 * @param {Date} date 日期对象
 * @param {string} fmt 格式，如 'yyyy-MM-dd'
 */
const formatDate = (date, fmt = 'yyyy-MM-dd') => {
  const o = {
    'M+': date.getMonth() + 1,
    'd+': date.getDate(),
    'h+': date.getHours(),
    'm+': date.getMinutes(),
    's+': date.getSeconds(),
    'q+': Math.floor((date.getMonth() + 3) / 3),
    'S': date.getMilliseconds()
  };
  if (/(y+)/.test(fmt)) {
    fmt = fmt.replace(RegExp.$1, (date.getFullYear() + '').substr(4 - RegExp.$1.length));
  }
  for (let k in o) {
    if (new RegExp('(' + k + ')').test(fmt)) {
      fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)));
    }
  }
  return fmt;
};

/**
 * 获取今天的日期字符串 yyyyMMdd（潮汐 API 需要）
 */
const getTodayStr = () => {
  const d = new Date();
  return formatDate(d, 'yyyyMMdd');
};

/**
 * 获取未来第 n 天的日期字符串
 */
const getFutureDateStr = (n = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return formatDate(d, 'yyyyMMdd');
};

/**
 * 星期几
 */
const getWeekDay = (dateStr) => {
  const d = new Date(dateStr.replace(/-/g, '/'));
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[d.getDay()];
};

/**
 * 天气图标映射（和风天气图标代码 -> 文字描述/emoji）
 * 完整图标列表: https://dev.qweather.com/docs/resource/icons/
 */
const weatherIconMap = {
  '100': { icon: '☀️', text: '晴' },
  '101': { icon: '🌤️', text: '多云' },
  '102': { icon: '⛅', text: '少云' },
  '103': { icon: '☁️', text: '晴间多云' },
  '104': { icon: '☁️', text: '阴' },
  '150': { icon: '🌙', text: '晴（夜）' },
  '151': { icon: '🌙', text: '多云（夜）' },
  '152': { icon: '🌙', text: '少云（夜）' },
  '153': { icon: '☁️', text: '晴间多云（夜）' },
  '300': { icon: '🌦️', text: '阵雨' },
  '301': { icon: '🌧️', text: '强阵雨' },
  '302': { icon: '⛈️', text: '雷阵雨' },
  '303': { icon: '⛈️', text: '强雷阵雨' },
  '304': { icon: '🌨️', text: '雷阵雨伴有冰雹' },
  '305': { icon: '🌦️', text: '小雨' },
  '306': { icon: '🌧️', text: '中雨' },
  '307': { icon: '🌧️', text: '大雨' },
  '308': { icon: '🌧️', text: '极端降雨' },
  '309': { icon: '🌦️', text: '毛毛雨' },
  '310': { icon: '🌧️', text: '暴雨' },
  '311': { icon: '🌧️', text: '大暴雨' },
  '312': { icon: '🌧️', text: '特大暴雨' },
  '313': { icon: '🧊', text: '冻雨' },
  '400': { icon: '❄️', text: '小雪' },
  '401': { icon: '❄️', text: '中雪' },
  '402': { icon: '❄️', text: '大雪' },
  '403': { icon: '❄️', text: '暴雪' },
  '404': { icon: '🌨️', text: '雨夹雪' },
  '405': { icon: '🌨️', text: '雨雪天气' },
  '406': { icon: '🌨️', text: '阵雨夹雪' },
  '407': { icon: '❄️', text: '阵雪' },
  '500': { icon: '🌫️', text: '薄雾' },
  '501': { icon: '🌫️', text: '雾' },
  '502': { icon: '🌫️', text: '霾' },
  '503': { icon: '💨', text: '扬沙' },
  '504': { icon: '💨', text: '浮尘' },
  '507': { icon: '💨', text: '沙尘暴' },
  '508': { icon: '💨', text: '强沙尘暴' },
  '900': { icon: '🔥', text: '热' },
  '901': { icon: '🥶', text: '冷' },
  '999': { icon: '❓', text: '未知' }
};

/**
 * 获取天气图标和文字
 */
/**
 * 获取和风官方 SVG 图标（本地文件，避免网络 SVG 渲染坑）
 * icon: 白色版，用于深色背景（全屏天空 hero / 蓝色天气卡）
 * iconDark: 深色版，用于浅色背景（逐时弹层白底 / 浅白预报卡）
 */
const getWeatherIcon = (code) => {
  const m = weatherIconMap[code];
  const c = m ? code : '104';
  return {
    icon: `/images/qweather/${c}.svg`,
    iconDark: `/images/qweather/${c}_d.svg`,
    text: m ? m.text : '未知'
  };
};

/**
 * 风向角度转文字
 */
const windAngleToDir = (angle) => {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const idx = Math.round(angle / 45) % 8;
  return dirs[idx] + '风';
};

/**
 * 获取风力等级描述
 */
const windScaleDesc = (scale) => {
  const s = parseInt(scale);
  if (s <= 1) return '微风';
  if (s <= 3) return '轻风';
  if (s <= 5) return '和风';
  if (s <= 7) return '强风';
  if (s <= 9) return '大风';
  if (s <= 11) return '狂风';
  return '飓风';
};

/**
 * 解析和风天气时间字符串（如 "2026-07-11T12:00-08:00"）
 * iOS 的 Date 不支持带时区偏移（且缺秒）的格式，这里手动拆分，
 * 忽略时区偏移、按站点当地时间构造 Date，保证各端显示一致。
 * @returns {Date|null}
 */
const parseTime = (isoStr) => {
  if (!isoStr || typeof isoStr !== 'string') return null;
  const m = isoStr.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  return isNaN(date.getTime()) ? null : date;
};

/**
 * 安全格式化更新时间："2026-07-11T12:00+08:00" -> "2026-07-11 12:00"
 * 不能用 new Date() 解析带时区偏移的字符串（iOS 会崩），这里用正则提取
 */
const formatUpdateTime = (str) => {
  if (!str) return '';
  const m = str.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : str;
};

const cityDisplayName = (loc) => {
  if (!loc) return '';
  return loc.name || loc.adm2 || loc.adm1 || '';
};

module.exports = {
  formatDate,
  getTodayStr,
  getFutureDateStr,
  getWeekDay,
  getWeatherIcon,
  windAngleToDir,
  windScaleDesc,
  parseTime,
  formatUpdateTime,
  cityDisplayName
};
