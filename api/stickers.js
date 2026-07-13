const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const dir = path.join(process.cwd(), 'stickers png');
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(files);
  } catch (e) {
    res.status(200).json([]);
  }
};
