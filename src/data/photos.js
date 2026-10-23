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

/** 云存储前缀（用户传图后由验收方填写，先留空） */
export const PHOTO_BASE = '';

/** 头像文件扩展名 */
export const PHOTO_EXT = '.jpg';

/**
 * 首批 30 城实拍头图
 * slug：云存储文件名（不含扩展名）；scene：场景说明；credit：版权署名（先留空）
 */
export const CITY_PHOTOS = {
  '重庆': { slug: 'chongqing', scene: '洪崖洞夜景', credit: '' },
  '成都': { slug: 'chengdu', scene: '春熙路太古里', credit: '' },
  '北京': { slug: 'beijing', scene: '天安门', credit: '' },
  '上海': { slug: 'shanghai', scene: '外滩', credit: '' },
  '西安': { slug: 'xian', scene: '大雁塔夜景', credit: '' },
  '长沙': { slug: 'changsha', scene: '橘子洲头', credit: '' },
  '南京': { slug: 'nanjing', scene: '紫峰大厦夜景', credit: '' },
  '杭州': { slug: 'hangzhou', scene: '西湖', credit: '' },
  '苏州': { slug: 'suzhou', scene: '东方之门夜景', credit: '' },
  '厦门': { slug: 'xiamen', scene: '双子塔夜景', credit: '' },
  '广州': { slug: 'guangzhou', scene: '广州塔夜景', credit: '' },
  '武汉': { slug: 'wuhan', scene: '黄鹤楼夜景', credit: '' },
  '天津': { slug: 'tianjin', scene: '天津之眼夜景', credit: '' },
  '青岛': { slug: 'qingdao', scene: '栈桥', credit: '' },
  '大连': { slug: 'dalian', scene: '星海广场', credit: '' },
  '哈尔滨': { slug: 'haerbin', scene: '圣索菲亚教堂', credit: '' },
  '沈阳': { slug: 'shenyang', scene: '中街', credit: '' },
  '昆明': { slug: 'kunming', scene: '金马碧鸡坊', credit: '' },
  '大理白族自治州': { slug: 'dali', scene: '崇圣寺三塔', credit: '' },
  '丽江': { slug: 'lijiang', scene: '玉龙雪山', credit: '' },
  '拉萨': { slug: 'lasa', scene: '布达拉宫', credit: '' },
  '乌鲁木齐': { slug: 'wulumuqi', scene: '国际大巴扎', credit: '' },
  '兰州': { slug: 'lanzhou', scene: '中山桥夜景', credit: '' },
  '黄山': { slug: 'huangshan', scene: '迎客松', credit: '' },
  '泉州': { slug: 'quanzhou', scene: '开元寺双塔', credit: '' },
  '福州': { slug: 'fuzhou', scene: '三坊七巷', credit: '' },
  '桂林': { slug: 'guilin', scene: '象鼻山夜景', credit: '' },
  '贵阳': { slug: 'guiyang', scene: '甲秀楼夜景', credit: '' },
  '洛阳': { slug: 'luoyang', scene: '龙门石窟', credit: '' },
  '扬州': { slug: 'yangzhou', scene: '瘦西湖', credit: '' }
};

export default { PHOTO_BASE, PHOTO_EXT, CITY_PHOTOS };
