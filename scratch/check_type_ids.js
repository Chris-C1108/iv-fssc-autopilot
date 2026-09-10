const fs = require('fs');
const content = fs.readFileSync('scratch_har_filtered.json', 'utf-8');
console.log('Size of scratch_har_filtered.json:', content.length);
const matches = Array.from(content.matchAll(/"expenseTypeId":\s*"([^"]+)"/g));
const typeIds = new Set(matches.map(m => m[1]));
console.log('Type IDs in scratch_har_filtered:', Array.from(typeIds));
