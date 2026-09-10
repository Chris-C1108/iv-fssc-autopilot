const fs = require('fs');

const file = 'assets/api ext/ync37.yuanian.com-002-报销批量助手-费用类型.har';
const content = fs.readFileSync(file, 'utf-8');
const target = '0356c4e2b72de1653e55bb00bc610001';

let idx = 0;
while ((idx = content.indexOf(target, idx)) !== -1) {
  const reqStart = content.lastIndexOf('{"startedDateTime"', idx);
  const urlIdx = content.indexOf('"url":', reqStart);
  const urlEnd = content.indexOf('",', urlIdx);
  const url = content.substring(urlIdx + 7, urlEnd);
  console.log(`Found target at ${idx}, URL: ${url}`);
  
  if (url.includes('getExpenseTypeFieldRuleListAndAllValueVO') || url.includes('initExpenseRecordData') || url.includes('validateAndSaveExpenseRecord')) {
    const respIdx = content.indexOf('"response":', idx);
    const textIdx = content.indexOf('"text":', respIdx);
    const quoteStart = textIdx + 8;
    let i = quoteStart;
    while (i < content.length) {
      if (content[i] === '"' && content[i-1] !== '\\') break;
      i++;
    }
    const escapedJson = content.substring(quoteStart, i);
    try {
      const unescaped = JSON.parse('"' + escapedJson + '"');
      const data = JSON.parse(unescaped);
      console.log('SUCCESS parsing endpoint:', url);
      if (data.data?.rowDatas) {
        console.log('rowDatas keys:', Object.keys(data.data.rowDatas));
      }
      if (data.data?.expenseTypeFieldRuleListVO?.expenseTypeFieldList) {
        console.log('Required fields:');
        data.data.expenseTypeFieldRuleListVO.expenseTypeFieldList
          .filter(f => f.fillBillRequired)
          .forEach(f => {
            console.log(`  * ${f.columnCode} (${f.columnName}): dataType=${f.dataType}, id=${f.expenseTypeFieldId}`);
          });
      }
      break;
    } catch(e) {
      console.log('Parse error:', e.message);
    }
  }
  idx += target.length;
}
