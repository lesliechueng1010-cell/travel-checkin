/**
 * 纯本地轨迹文件解析（GPX / KML）
 * 只做三件事：认出格式、抽出经纬度（与时间）、按城市聚合。
 * 全程只在内存里处理文本，不联网、不上传、不写临时文件。
 * 解析不出来的文件返回空点集，由调用方按「跳过」计数并注明原因，绝不猜测。
 */
import { parseDateTimeString } from './exif.js';

/** 单个文件最多参与匹配的轨迹点数（防长轨迹卡顿） */
export const TRACK_POINT_LIMIT = 5000;
/** 单文件收集上限，超大文件只读前 4 万个点，避免内存与主线程被拖住 */
const COLLECT_CAP = 40000;

const GPX_PT = /<(trkpt|wpt)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
const GPX_LAT = /\blat\s*=\s*["']([^"']+)["']/i;
const GPX_LON = /\blon\s*=\s*["']([^"']+)["']/i;
const GPX_TIME = /<time>\s*([^<]+?)\s*<\/time>/i;

const KML_COORDS = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
const KML_GXCOORD = /<gx:coord>([\s\S]*?)<\/gx:coord>/gi;

function toNum(s) {
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}

/** 坐标合法性：范围 + 排除 (0,0) 这种占位值 */
function validPoint(lat, lng) {
  return lat !== null && lng !== null &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/**
 * 相同 / 极近的点合并（约 100m 粒度），保留最早的时间
 * 只影响计算量，不影响「城市 + 最早年份」的结论
 */
function dedupePoints(points) {
  const map = new Map();
  for (const p of points) {
    const key = p.lat.toFixed(3) + ',' + p.lng.toFixed(3);
    const prev = map.get(key);
    if (!prev) { map.set(key, p); continue; }
    if (p.time && (!prev.time || p.time < prev.time)) prev.time = p.time;
  }
  return Array.from(map.values());
}

/** 均匀抽样到 limit 以内（覆盖整条轨迹，而不是只取开头） */
function samplePoints(points, limit = TRACK_POINT_LIMIT) {
  if (points.length <= limit) return points;
  const stride = Math.ceil(points.length / limit);
  const out = [];
  for (let i = 0; i < points.length && out.length < limit; i += stride) out.push(points[i]);
  return out;
}

/**
 * 识别格式：先看扩展名，扩展名不认识再看文件头（只看内容，不猜）
 * @returns {'gpx'|'kml'|'unknown'}
 */
export function detectTrackFormat(name, text) {
  const n = String(name || '').toLowerCase();
  if (/\.gpx$/.test(n)) return 'gpx';
  if (/\.kml$/.test(n)) return 'kml';
  const head = String(text || '').slice(0, 600).toLowerCase();
  if (head.includes('<gpx')) return 'gpx';
  if (head.includes('<kml')) return 'kml';
  return 'unknown';
}

/**
 * 解析 GPX：trkpt / wpt 的 lat、lon，以及其内的 time
 * @returns {{points:Array<{lat:number,lng:number,time:string}>, total:number}}
 */
export function parseGpxPoints(text) {
  const src = String(text || '');
  const all = [];
  let total = 0;
  GPX_PT.lastIndex = 0;
  let m;
  while ((m = GPX_PT.exec(src))) {
    const attrs = m[2] || '';
    const inner = m[3] || '';
    const lat = toNum((attrs.match(GPX_LAT) || [])[1]);
    const lng = toNum((attrs.match(GPX_LON) || [])[1]);
    if (!validPoint(lat, lng)) continue;
    total++;
    if (all.length >= COLLECT_CAP) break;
    const t = inner.match(GPX_TIME);
    all.push({ lat, lng, time: t ? t[1] : '' });
  }
  return { points: samplePoints(dedupePoints(all)), total };
}

/**
 * 解析 KML：<coordinates> 里的 "lng,lat[,alt]" 三元组；顺带兼容 gx:coord 的 "lng lat alt"
 * KML 本身不带时间信息，因此 time 一律为空（年份留空，由用户手填）
 * @returns {{points:Array<{lat:number,lng:number,time:string}>, total:number}}
 */
export function parseKmlPoints(text) {
  const src = String(text || '');
  const all = [];
  let total = 0;

  const pushLngLat = (lng, lat, alt) => {
    if (!validPoint(lat, lng)) return;
    total++;
    if (all.length >= COLLECT_CAP) return;
    all.push({ lat, lng, time: '' });
  };

  KML_COORDS.lastIndex = 0;
  let m;
  while ((m = KML_COORDS.exec(src)) && all.length < COLLECT_CAP) {
    const parts = (m[1] || '').trim().split(/\s+/);
    for (const p of parts) {
      if (all.length >= COLLECT_CAP) break;
      const t = p.split(',');
      if (t.length < 2) continue;
      pushLngLat(toNum(t[0]), toNum(t[1]), t[2]);
    }
  }

  KML_GXCOORD.lastIndex = 0;
  while ((m = KML_GXCOORD.exec(src)) && all.length < COLLECT_CAP) {
    const t = (m[1] || '').trim().split(/\s+/);
    if (t.length < 2) continue;
    pushLngLat(toNum(t[0]), toNum(t[1]), t[2]);
  }

  return { points: samplePoints(dedupePoints(all)), total };
}

/** 按扩展名/内容解析单个轨迹文件 */
export function parseTrackFile(name, text) {
  const format = detectTrackFormat(name, text);
  if (format === 'unknown') return { format, points: [], total: 0 };
  const r = format === 'gpx' ? parseGpxPoints(text) : parseKmlPoints(text);
  return { format, points: r.points, total: r.total };
}

/**
 * 轨迹点 → 城市集合（每城取最早轨迹日期）
 * @param {Array<{lat:number,lng:number,time:string}>} points
 * @param {(loc:{lat:number,lng:number}) => ({city:object}|null)} match 注入 matchCityWithin
 * @returns {Array<{name:string, date:string}>} date 为 '' 表示该城市没有可用日期
 */
export function citiesFromPoints(points, match) {
  const byCity = new Map();
  (points || []).forEach(p => {
    const hit = match({ lat: p.lat, lng: p.lng });
    if (!hit || !hit.city) return;
    const name = hit.city.name;
    const date = parseDateTimeString(p.time || '');
    if (!byCity.has(name)) { byCity.set(name, date); return; }
    const prev = byCity.get(name);
    if (date && (!prev || date < prev)) byCity.set(name, date);   // 首次到访取最早
  });
  return Array.from(byCity.entries()).map(([name, date]) => ({ name, date }));
}

export default { TRACK_POINT_LIMIT, detectTrackFormat, parseGpxPoints, parseKmlPoints, parseTrackFile, citiesFromPoints };
