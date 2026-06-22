const fs = require('fs')
const p = process.argv[2]
const out = process.argv[3] || 'C:/ゲーム開発/ゲーム開発/sand-studio/scripts/_composite.jpg'
let d = fs.readFileSync(p, 'utf8').trim().replace(/^"|"$/g, '')
const i = d.indexOf('base64,')
const b = i >= 0 ? d.slice(i + 7) : d
fs.writeFileSync(out, Buffer.from(b, 'base64'))
console.log('ok', b.length, '->', out)
