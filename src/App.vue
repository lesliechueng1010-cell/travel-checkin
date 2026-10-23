<script>
import { CONFIG } from './config.js';
import store from './core/store.js';

export default {
  onLaunch() {
    // #ifdef MP-WEIXIN
    if (CONFIG.cloudEnv && typeof wx !== 'undefined' && wx.cloud) {
      wx.cloud.init({ env: CONFIG.cloudEnv, traceUser: true });
    }
    // #endif
    // 1.3.3：云初始化后拉一次云端数据（本地存档的加载已在 import store 时完成）
    // boot 是 async，这里不 await：它的失败不能影响 App 启动
    try {
      const p = store.boot();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  }
};
</script>
<style>
@import './styles/theme.scss';
</style>
