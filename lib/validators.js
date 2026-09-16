// 验证工具函数
function validateUsername(username) {
  if (!username || username.length < 6) return '用户名最短不少于6个字符';
  if (username.length > 20) return '用户名最长不超过20个字符';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return '用户名只允许数字、下划线、英文大小写字母';
  return null;
}

function validatePassword(password) {
  if (!password || password.length < 6) return '密码必须是6个字符以上';
  if (password.length > 12) return '密码最长不超过12个字符';
  if (!/[0-9]/.test(password)) return '密码必须包含数字';
  if (!/[a-z]/.test(password)) return '密码必须包含英文小写字母';
  if (!/[A-Z]/.test(password)) return '密码必须包含英文大写字母';
  return null;
}

function validateEmail(email) {
  if (!email) return '请输入邮箱地址';
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!re.test(email)) return '请输入正确的邮箱地址';
  return null;
}

function validatePhone(phone) {
  if (!phone) return '请输入手机号码';
  const re = /^1[3-9]\d{9}$/;
  if (!re.test(phone)) return '请输入正确的手机号码';
  return null;
}

function validateRealName(name) {
  if (!name) return '请输入姓名';
  const re = /^[\u4e00-\u9fa5]+$/;
  if (!re.test(name)) return '姓名只允许输入汉字';
  if (name.length < 2) return '姓名不少于2个汉字';
  if (name.length > 4) return '姓名不超过4个汉字';
  return null;
}

function validateDepartment(dept) {
  if (!dept) return '请输入部门';
  if (dept.length > 30) return '部门不超过30个字符';
  return null;
}

function validateLaborRelation(lr) {
  if (!lr) return '请选择劳动关系';
  if (!['国脉员工', '非国脉员工'].includes(lr)) return '劳动关系选项不正确';
  return null;
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `XXX@${domain}`;
}

function generateRandomPassword() {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  let pwd = '';
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  for (let i = 0; i < 5; i++) {
    const sets = [lower, upper, digits];
    const s = sets[Math.floor(Math.random() * sets.length)];
    pwd += s[Math.floor(Math.random() * s.length)];
  }
  return pwd;
}

function generateToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

module.exports = {
  validateUsername,
  validatePassword,
  validateEmail,
  validatePhone,
  validateRealName,
  validateDepartment,
  validateLaborRelation,
  maskEmail,
  generateRandomPassword,
  generateToken,
};
