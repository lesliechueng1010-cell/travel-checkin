<template>
  <view class="page">
    <!-- 城市专项安全（从城市详情进入时置顶） -->
    <view class="danger-block" v-if="citySafety">
      <view class="dt">⚠️ {{ citySafety.name }} · 危险注意事项</view>
      <text class="danger-text">{{ citySafety.danger }}</text>
      <view v-for="(s, i) in citySafety.safety" :key="'c' + i" style="margin-top:14rpx">
        <text class="chip red">{{ s.t }}</text>
        <view class="danger-text" style="font-size:24rpx" v-for="(it, j) in s.items" :key="j">· {{ it }}</view>
      </view>
    </view>

    <!-- 类型化安全知识 -->
    <view class="card">
      <text class="h3">按环境类型查看安全知识</text>
      <view class="tabs">
        <text v-for="t in types" :key="t" class="tab" :class="{ on: curType === t }" @tap="curType = t">{{ t }}</text>
      </view>
      <view class="safety-list">
        <view class="safety-item" v-for="(item, i) in KNOWLEDGE[curType]" :key="i">{{ item }}</view>
      </view>
      <view class="notice" style="margin-top:20rpx">{{ DISCLAIMER }}</view>
    </view>

    <view style="height: 220rpx"></view>

    <!-- 紧急求助固定栏 -->
    <view class="sos-bar">
      <view class="sos-loc">
        <text class="sos-cap">当前定位</text>
        <text class="sos-city">{{ locText }}</text>
      </view>
      <button class="sos-btn call-110" @tap="call('110')">拨打 110</button>
      <button class="sos-btn call-120" @tap="call('120')">拨打 120</button>
    </view>
  </view>
</template>

<script>
import store from '../../core/store.js';
import { locateCity } from '../../core/logic.js';
import { getGuideData } from '../../data/guides.js';
import { findCity } from '../../data/cities.js';
import { SAFETY_DISCLAIMER } from '../../config.js';

const KNOWLEDGE = {
  高原: [
    '抵达高海拔地区前 1-2 天避免剧烈运动与饮酒，给身体留出适应时间',
    '出现剧烈头痛、呕吐、严重气短时立即就医或下撤到低海拔，勿硬扛',
    '高原紫外线极强，墨镜、防晒霜、遮阳帽必备',
    '昼夜温差大，夏季也要带抓绒或羽绒外套',
    '有心脑血管疾病、重感冒者不宜进入高海拔区域'
  ],
  沙漠: [
    '进入沙漠务必结伴、带足饮用水，跟随正规营地或持证向导',
    '沙漠昼夜温差极大，风沙天备口罩、防风镜',
    '手机在沙漠深处常无信号，出发前把行程告知可靠联系人',
    '沙暴来临立即停止行进，背风躲避，保护口鼻与电子设备',
    '沙漠公路风景照必须在安全停车区拍摄，严禁路中间停留'
  ],
  冰雪: [
    '冬季自驾使用雪地胎或防滑链，出发前查询封路与管制信息',
    '户外活动注意保暖防冻伤，手机低温掉电快，贴身存放并带充电宝',
    '冰面活动只在官方开放区域进行，严禁上野冰',
    '滑雪请选正规雪场，佩戴头盔等护具，量力选择雪道',
    '极寒地区长时间户外定时进屋取暖，防止失温'
  ],
  雨季: [
    '汛期出行前查看气象与景区公告，预警生效时调整或取消行程',
    '山区防塌方、落石与山洪，勿在河道、沟谷内扎营停留',
    '雨后徒步步道湿滑，穿防滑鞋并使用登山杖',
    '台风预警期间避免海边、山区与户外行程，渡轮航线可能停航',
    '驾车涉水前观察水深，不明水情坚决绕行'
  ],
  海滨: [
    '下海游泳只在有救生员的开放水域，遵循警示旗与广播',
    '离岸流是海滩最大杀手，遇离岸流保持冷静、平行海岸游出',
    '紫外线强烈，防晒并定时补水，正午避免暴晒',
    '赶海与礁石区活动先看潮汐表，涨潮前及时撤离',
    '水上项目选择有资质商家并确认含意外保险'
  ],
  边境: [
    '前往边境管理区需提前办理边防证，向户籍地或属地公安机关咨询',
    '边境地区拍照避开敏感设施，听从边防人员管理',
    '部分边境线路无信号、补给间距远，结伴而行并备足物资'
  ],
  城市: [
    '热门景区人流密集，注意随身财物与同行儿童看护',
    '夜间活动选择照明良好的主干道与正规场所',
    '陌生城市打车使用正规平台，上车前核对车牌',
    '自驾前了解当地限行政策与停车资源',
    '品尝地方美食注意食材过敏与卫生，肠胃敏感者循序渐进'
  ]
};

export default {
  data() {
    return {
      types: Object.keys(KNOWLEDGE),
      curType: '高原',
      citySafety: null,
      locText: '定位中…',
      KNOWLEDGE,
      DISCLAIMER: SAFETY_DISCLAIMER
    };
  },
  onLoad(query) {
    const name = query.city ? decodeURIComponent(query.city) : '';
    if (name) {
      const city = findCity(name);
      if (city) {
        const g = getGuideData(city);
        this.citySafety = { name, safety: g.safety, danger: g.danger };
        const types = (g.safety || []).map(s => s.t);
        if (types.length) this.curType = types[0];
      }
    }
    this.locate();
  },
  methods: {
    locate() {
      uni.getLocation({
        type: 'gcj02',
        success: loc => {
          store.setLastLoc({ lat: loc.latitude, lng: loc.longitude });
          const near = locateCity({ lat: loc.latitude, lng: loc.longitude });
          this.locText = near ? `${near.name}（约 ${near.dist} km）` : `${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}`;
        },
        fail: () => { this.locText = '未授权定位（打开右上角设置可授权）'; }
      });
    },
    call(num) {
      uni.makePhoneCall({
        phoneNumber: num,
        fail: e => uni.showToast({ title: '未能拉起拨号：' + (e.errMsg || ''), icon: 'none' })
      });
    }
  }
};
</script>

<style scoped>
.tabs { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 22rpx 0; }
.tab {
  padding: 12rpx 28rpx; border-radius: 999rpx;
  background: rgba(245, 240, 230, 0.05);
  border: 1rpx solid rgba(245, 240, 230, 0.12);
  color: rgba(242, 237, 227, 0.55); font-size: 24rpx;
}
.tab.on {
  background: rgba(217, 179, 106, 0.14);
  border-color: rgba(217, 179, 106, 0.55);
  color: #D9B36A; font-weight: 700;
}
.safety-item {
  color: rgba(242, 237, 227, 0.62);
  font-size: 26rpx; line-height: 1.9; padding: 8rpx 0;
}
.sos-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
  background: rgba(9, 30, 52, 0.94);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-top: 1rpx solid rgba(214, 122, 110, 0.45);
  display: flex; align-items: center; gap: 16rpx;
  padding: 20rpx 24rpx calc(20rpx + env(safe-area-inset-bottom));
}
.sos-loc { flex: 1; min-width: 0; }
.sos-cap { display: block; font-size: 20rpx; color: rgba(242, 237, 227, 0.55); }
.sos-city { display: block; font-size: 26rpx; color: #F2EDE3; margin-top: 4rpx; }
.sos-btn {
  border-radius: 999rpx; font-size: 26rpx; font-weight: 700;
  height: 84rpx; line-height: 84rpx; padding: 0 34rpx; border: none;
}
.sos-btn::after { border: none; }
.call-110 { background: #C45648; color: #FFF5F2; }
.call-120 { background: linear-gradient(135deg, #E7C98C 0%, #D9B36A 100%); color: #0A1E34; }
</style>
