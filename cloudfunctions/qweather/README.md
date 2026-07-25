# 云函数 qweather（微信云开发代理）

把和风天气的 KEY 放云端，小程序通过 `wx.cloud.callFunction` 调用本函数，
由函数在服务端注入 KEY 并转发。前端不持有任何密钥，反编译也拿不到。

## 部署步骤
1. 微信开发者工具打开项目，点左上「云开发」图标，开通云开发环境（个人小程序可开通，有免费额度）。本项目环境 ID 已写入代码：`cloud1-d3gvlu91fc41b9439`。
2. 在 `cloudfunctions/qweather` 目录右键「上传并部署：云端安装依赖」（本函数零依赖，直接部署即可）。
3. 部署后在云函数列表里点 `qweather` → 「配置」→ 添加环境变量 `QWEATHER_KEY`。
   ⚠️ **Key 安全提醒**：旧 `key1`（`425cae8a…`）此前已明文泄露在小程序包中，**切勿再使用**，请到和风控制台将其重置失效；此处应填写**未泄露的新 key（`key2` `6c204851…`）**。KEY 只存在云端环境变量，不会进入小程序包，反编译也拿不到。
4. 保存后重启该函数使环境变量生效，再到「日志」里测试调用验证。

## 小程序端调用（已完成改造）
`utils/api.js` 的 `request()` 已改为走 `wx.cloud.callFunction({ name: 'qweather', data: { path, params } })`，
各业务函数路径不变（如 `'v7/weather/now'`、`'geo/v2/city/lookup'`）。
`app.js` 的 `onLaunch` 已加入 `wx.cloud.init({ env: 'cloud1-d3gvlu91fc41b9439', traceUser: true })`。

## 与 request 直连代理的区别
- 走 `wx.cloud.callFunction` 是微信内网通道，**无需配置 request 合法域名、无需备案域名**。
- 免费额度内基本零成本；免自备服务器、免 Lucky/DDNS/证书运维。
