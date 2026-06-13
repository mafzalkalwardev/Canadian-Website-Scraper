function isJunkMediaUrl(value) {
  if (!value || typeof value !== 'string') return true;
  return /unflagged|flagged|questionflag|theme\/image\.php|\/i\/unflagged|\/i\/flagged|pix\/i\/|\.svg(\?|$)/i.test(value);
}

module.exports = { isJunkMediaUrl };
