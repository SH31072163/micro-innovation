const jwt = require('jsonwebtoken');

const SECRET_KEY = 'micro-innovation-secret-key-2026-gmwl';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
    },
    SECRET_KEY,
    { expiresIn: '24h' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (err) {
    return null;
  }
}

function getUserFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  return verifyToken(token);
}

module.exports = { generateToken, verifyToken, getUserFromRequest, SECRET_KEY };
