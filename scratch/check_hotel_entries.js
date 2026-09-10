const fs = require('fs');
const content = fs.readFileSync('scratch_har_filtered.json', 'utf-8');
const target = '0356c4e2b72de1653e55bb00bc610001';

let idx = 0;
while ((idx = content.indexOf(target, idx)) !== -1) {
  // Find URL and method
  const urlStart = content.lastIndexOf('"url":', idx);
  const urlEnd = content.indexOf('",', urlStart);
  const url = content.substring(urlStart + 7, urlEnd);
  console.log(`Pos ${idx}: ${url}`);
  
  // If this is initExpenseRecordData or getExpenseTypeFieldRuleListAndAllValueVO or validateAndSaveExpenseRecord
  if (url.includes('initExpenseRecordData') || url.includes('getExpenseTypeFieldRuleListAndAllValueVO') || url.includes('validateAndSaveExpenseRecord') || url.includes('fieldValueChange')) {
    // Find enclosing entry
    const entryStart = content.lastIndexOf('{\n    "method"', idx);
    const nextEntry = content.indexOf('{\n    "method"', idx + 100);
    const entryChunk = content.substring(entryStart !== -1 ? entryStart : idx - 200, nextEntry !== -1 ? nextEntry : idx + 20000);
    try {
      const parsed = JSON.parse(entryChunk.replace(/,\s*$/, ''));
      console.log('Parsed entry url:', parsed.url);
      if (parsed.response?.data) {
        const d = parsed.response.data;
        if (d.rowDatas) console.log('  rowDatas keys:', Object.keys(d.rowDatas));
        if (d.expenseTypeFieldRuleListVO?.expenseTypeFieldList) {
          console.log('  Required fields:');
          d.expenseTypeFieldRuleListVO.expenseTypeFieldList
            .filter(f => f.fillBillRequired)
            .forEach(f => console.log(`    - ${f.columnCode} (${f.columnName}): type=${f.dataType}, id=${f.expenseTypeFieldId}`));
        }
      }
      if (parsed.request?.postData) {
        console.log('  request keys:', Object.keys(parsed.request.postData));
        if (parsed.request.postData.rowDatas) {
          console.log('  req rowDatas keys:', Object.keys(parsed.request.postData.rowDatas));
        }
      }
    } catch(e) {
      console.log('Chunk parse error:', e.message);
    }
  }
  idx += target.length;
}
