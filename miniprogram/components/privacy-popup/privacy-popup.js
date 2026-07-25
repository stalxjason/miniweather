// 隐私授权弹窗组件（自包含，无需 npm 依赖）
// 配合 app.json 的 "__usePrivacyCheck__": true 使用：
// 任意隐私接口（如 wx.getLocation）被调用且未授权时，框架会触发 onNeedPrivacyAuthorization，
// 本组件据此弹出授权提示；用户同意后调用 resolve，框架自动重试原接口（如定位）。
Component({
  data: {
    show: false
  },

  lifetimes: {
    attached() {
      const that = this;
      // 注册隐私授权监听（框架在需要时回调）。多个页面各自挂该组件，但同一时刻仅一个页面活跃。
      wx.onNeedPrivacyAuthorization((resolve) => {
        that._resolve = resolve;
        that.setData({ show: true });
      });
    }
  },

  methods: {
    // 查看隐私保护指引（需在微信公众平台配置隐私协议）
    openContract() {
      wx.openPrivacyContract({
        fail: () => {
          wx.showToast({ title: '暂无法打开隐私协议', icon: 'none' });
        }
      });
    },

    // 同意：通知框架已授权，原隐私接口（如定位）将自动重试
    agree() {
      if (this._resolve) {
        this._resolve({ event: 'agree' });
        this._resolve = null;
      }
      this.setData({ show: false });
    },

    // 拒绝：必须调用 resolve 通知框架（event:'disagree'），否则原隐私接口（如 getLocation）
    // 会一直挂起不返回，导致页面卡死。resolve 后 getLocation 将 fail，走兜底默认城市。
    disagree() {
      if (this._resolve) {
        this._resolve({ event: 'disagree' });
        this._resolve = null;
      }
      this.setData({ show: false });
      wx.showToast({ title: '未同意将无法使用定位', icon: 'none' });
    }
  }
});
