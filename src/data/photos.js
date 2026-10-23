/**
 * 城市实拍头图清单（1.5.0）
 *
 * 数据红线：
 * - 图片一律走云存储远程加载，**代码包里不放任何图片文件**；
 * - 只登记「城市 → 图名 + 场景说明 + 版权署名」，不写任何编造的景点数据。
 *
 * 使用方式：
 * 1. 用户把图片上传到云存储目录 city-photos/，文件名 = slug + '.jpg'；
 * 2. 把 PHOTO_BASE 填成云存储前缀（如 'cloud://travel-checkin-d6g1yag6s4ceb9790.xxxx/city-photos/'）；
 * 3. 城市详情页在 PHOTO_BASE 非空且本表有该城市时才显示照片横幅，否则保持原渐变头部。
 *
 * 未填 PHOTO_BASE 时（当前状态）前端不发起任何图片请求，不会白屏、不会报错。
 */

/** 云存储前缀（city-photos/ 目录，图片一律远程加载，代码包内零图片） */
export const PHOTO_BASE = 'cloud://travel-checkin-d6g1yag6s4ceb9790.7472-travel-checkin-d6g1yag6s4ceb9790-1514737499/city-photos/';

/** 头像文件扩展名 */
export const PHOTO_EXT = '.jpg';

/**
 * 首批 30 城实拍头图
 * slug：云存储文件名（不含扩展名）；scene：场景说明；credit：版权署名（先留空）
 */
export const CITY_PHOTOS = {
  '重庆': { slug: 'chongqing', scene: '洪崖洞夜景', credit: '摄影：Jonashtand · CC BY-SA 4.0 · Wikimedia Commons' },
  '成都': { slug: 'chengdu', scene: '春熙路太古里', credit: '摄影：EditQ · CC0 · Wikimedia Commons' },
  '北京': { slug: 'beijing', scene: '天安门', credit: '摄影：Charlie fong（冯成） · Public Domain · Wikimedia Commons' },
  '上海': { slug: 'shanghai', scene: '外滩', credit: '摄影：Lloyd Tudor · CC BY-SA 4.0 · Wikimedia Commons' },
  '西安': { slug: 'xian', scene: '大雁塔夜景', credit: '摄影：Windmemories · CC BY-SA 4.0 · Wikimedia Commons' },
  '长沙': { slug: 'changsha', scene: '橘子洲头', credit: '用户供图' },
  '南京': { slug: 'nanjing', scene: '紫峰大厦夜景', credit: '摄影：董辰兴 · CC BY-SA 4.0 · Wikimedia Commons' },
  '杭州': { slug: 'hangzhou', scene: '西湖', credit: '摄影：Louisa Salazar · CC BY-SA 3.0 · Wikimedia Commons' },
  '苏州': { slug: 'suzhou', scene: '金鸡湖东方之门', credit: '用户供图' },
  '厦门': { slug: 'xiamen', scene: '双子塔黄昏', credit: '摄影：周流劲火 · CC BY 2.5 · Wikimedia Commons' },
  '广州': { slug: 'guangzhou', scene: '广州塔夜景', credit: '摄影：Tim Wu · CC BY-SA 4.0 · Wikimedia Commons' },
  '武汉': { slug: 'wuhan', scene: '黄鹤楼', credit: '用户供图' },
  '天津': { slug: 'tianjin', scene: '天津之眼夜景', credit: '摄影：kele_jb1984 · CC BY-SA 2.0 · Wikimedia Commons' },
  '青岛': { slug: 'qingdao', scene: '栈桥', credit: '摄影：Vitsuha · CC BY-SA 4.0 · Wikimedia Commons' },
  '大连': { slug: 'dalian', scene: '港东五街大船', credit: '用户供图' },
  '哈尔滨': { slug: 'haerbin', scene: '圣索菲亚教堂', credit: '用户供图' },
  '沈阳': { slug: 'shenyang', scene: '中街', credit: '摄影：TurnOnTheNight · CC BY-SA 4.0 · Wikimedia Commons' },
  '昆明': { slug: 'kunming', scene: '金马碧鸡坊', credit: '摄影：tak.wing · CC BY-SA 2.0 · Wikimedia Commons' },
  '大理白族自治州': { slug: 'dali', scene: '洱海', credit: '用户供图' },
  '丽江': { slug: 'lijiang', scene: '玉龙雪山', credit: '摄影：Ma Martin · CC BY-SA 3.0 · Wikimedia Commons' },
  '拉萨': { slug: 'lasa', scene: '布达拉宫', credit: '摄影：McKay Savage · CC BY 2.0 · Wikimedia Commons' },
  '乌鲁木齐': { slug: 'wulumuqi', scene: '国际大巴扎', credit: '摄影：螺钉 · CC BY-SA 4.0 · Wikimedia Commons' },
  '兰州': { slug: 'lanzhou', scene: '中山桥夜景', credit: '摄影：Pieceofmetalwork · CC BY-SA 4.0 · Wikimedia Commons' },
  '黄山': { slug: 'huangshan', scene: '迎客松', credit: '摄影：De-Shao Liu (Terry850324) · CC BY-SA 4.0 · Wikimedia Commons' },
  '泉州': { slug: 'quanzhou', scene: '开元寺双塔', credit: '摄影：Windmemories · CC BY-SA 4.0 · Wikimedia Commons' },
  '福州': { slug: 'fuzhou', scene: '三坊七巷', credit: '摄影：Lennartbj · CC BY-SA 4.0 · Wikimedia Commons' },
  '桂林': { slug: 'guilin', scene: '漓江峰林', credit: '用户供图' },
  '贵阳': { slug: 'guiyang', scene: '甲秀楼夜景', credit: '摄影：FN-082 · CC BY-SA 4.0 · Wikimedia Commons' },
  '洛阳': { slug: 'luoyang', scene: '龙门石窟', credit: '摄影：Roci xu · CC BY-SA 4.0 · Wikimedia Commons' },
  '扬州': { slug: 'yangzhou', scene: '瘦西湖五亭桥', credit: '用户供图' }
};

export default { PHOTO_BASE, PHOTO_EXT, CITY_PHOTOS };
