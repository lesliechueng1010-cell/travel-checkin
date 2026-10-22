<script>
import { CONFIG } from './config.js';

export default {
  onLaunch() {
    // #ifdef MP-WEIXIN
    if (CONFIG.cloudEnv && typeof wx !== 'undefined' && wx.cloud) {
      wx.cloud.init({ env: CONFIG.cloudEnv, traceUser: true });
    }
    // #endif
  }
};
</script>
<style>
@import './styles/theme.scss';
</style>
