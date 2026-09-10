const fs = require('fs');

const files = [
  'assets/har/ync37.yuanian.com.har',
  'assets/api ext/ync37.yuanian.com-002-报销批量助手-费用类型.har'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  console.log('--- ' + file + ' ---');
  const content = fs.readFileSync(file, 'utf-8');
  const target = '\\"message\\":\\"';
  let pos = 0;
  const msgs = new Set();
  while ((pos = content.indexOf(target, pos)) !== -1) {
    const start = pos + target.length;
    const end = content.indexOf('\\"', start);
    const msg = content.substring(start, end);
    if (msg.length > 0 && msg.length < 100) msgs.add(msg);
    pos = end + 2;
  }
  Array.from(msgs).forEach(m => console.log(' -', m));
}
