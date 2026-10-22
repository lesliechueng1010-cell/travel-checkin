/**
 * 云函数 login：获取 openid（微信登录，无账号密码）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  return { ok: true, openid: OPENID };
};
