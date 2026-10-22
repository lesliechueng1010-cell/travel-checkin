/**
 * 导航模块 —— 三地图选择菜单 + 明确的成功/降级反馈
 *
 * 微信小程序能力边界（如实告知，不含糊）：
 *  - 腾讯地图：可直接"拉起"——wx.openLocation 打开微信内置腾讯地图（含路线预览，
 *    底部还可继续拉起本机已安装的高德/百度 App），属于直跳方案。
 *  - 高德地图 / 百度地图：微信小程序内没有官方 API 直接打开第三方地图 App 并带入目的地，
 *    采用降级方案：自动复制目的地名称 → 明确提示用户打开对应地图 App 粘贴搜索。
 *  - 每个选项点击后必有 toast/modal 反馈，不会出现点了没反应的情况。
 */
export function openNavMenu(city) {
  uni.showActionSheet({
    itemList: ['腾讯地图（打开地图预览）', '高德地图（复制地名去打开）', '百度地图（复制地名去打开）'],
    success: res => {
      if (res.tapIndex === 0) openTencent(city);
      else if (res.tapIndex === 1) copyToGaode(city);
      else copyToBaidu(city);
    },
    fail: () => {}
  });
}

function openTencent(city) {
  uni.openLocation({
    latitude: city.lat,
    longitude: city.lng,
    name: city.name,
    address: `${city.prov} · ${city.name}`,
    scale: 12,
    success: () => {
      uni.showToast({ title: '已打开腾讯地图，可查看路线', icon: 'none', duration: 2000 });
    },
    fail: () => {
      // 内置地图拉起失败 → 与高德/百度相同的降级方案，保证有反馈
      copyAndPrompt(city.name, '腾讯地图',
        '未能打开地图预览，已为你复制地名「' + city.name + '」，请打开腾讯地图 App 粘贴搜索');
    }
  });
}

function copyToGaode(city) {
  copyAndPrompt(city.name, '高德地图',
    '微信小程序无法直接拉起高德地图。已复制「' + city.name + '」，请打开高德地图 App，粘贴搜索后开始导航');
}

function copyToBaidu(city) {
  copyAndPrompt(city.name, '百度地图',
    '微信小程序无法直接拉起百度地图。已复制「' + city.name + '」，请打开百度地图 App，粘贴搜索后开始导航');
}

function copyAndPrompt(name, app, msg) {
  uni.setClipboardData({
    data: name,
    success: () => {
      uni.showModal({
        title: '已复制目的地',
        content: msg,
        confirmText: '知道了',
        showCancel: false
      });
    },
    fail: () => {
      uni.showModal({
        title: '请手动搜索',
        content: '复制失败，请手动打开' + app + '搜索「' + name + '」开始导航',
        confirmText: '知道了',
        showCancel: false
      });
    }
  });
}

export default { openNavMenu };
