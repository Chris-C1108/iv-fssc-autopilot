const fs = require('fs');
const path = require('path');

function getHarFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getHarFiles(filePath, fileList);
    } else if (file.endsWith('.har') && file.includes('ync37.yuanian.com')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const harFiles = getHarFiles(path.resolve(__dirname, 'assets'));
console.log('Found Yuannian HAR files:', harFiles.length);

const endpointMap = new Map();

for (const f of harFiles) {
  try {
    const content = fs.readFileSync(f, 'utf8');
    const json = JSON.parse(content);
    const entries = json.log.entries || [];
    for (const entry of entries) {
      const req = entry.request;
      const res = entry.response;
      if (!req || !req.url) continue;
      const u = new URL(req.url);
      if (!u.hostname.includes('yuanian.com')) continue;
      
      const pathname = u.pathname;
      if (!endpointMap.has(pathname)) {
        endpointMap.set(pathname, {
          methods: new Set(),
          files: new Set(),
          sampleQueries: new Set(),
          postDataKeys: new Set(),
          statusCodes: new Set(),
          sampleBody: null,
          sampleResponse: null
        });
      }
      const item = endpointMap.get(pathname);
      item.methods.add(req.method);
      item.files.add(path.basename(f));
      item.statusCodes.add(res.status);
      if (u.search) item.sampleQueries.add(u.search);

      if (req.postData && req.postData.text) {
        try {
          const body = JSON.parse(req.postData.text);
          if (body && typeof body === 'object') {
            Object.keys(body).forEach(k => item.postDataKeys.add(k));
            if (!item.sampleBody) {
              item.sampleBody = body;
            }
          }
        } catch(e) {}
      }
      if (!item.sampleResponse && res.content && res.content.text) {
        try {
          const resJson = JSON.parse(res.content.text);
          item.sampleResponse = resJson;
        } catch(e) {}
      }
    }
  } catch(e) {
    console.error('Error parsing', f, e.message);
  }
}

const result = [];
const sortedEndpoints = Array.from(endpointMap.keys()).sort();
for (const ep of sortedEndpoints) {
  const data = endpointMap.get(ep);
  result.push({
    endpoint: ep,
    methods: Array.from(data.methods),
    files: Array.from(data.files),
    statusCodes: Array.from(data.statusCodes),
    postDataKeys: Array.from(data.postDataKeys),
    sampleQueries: Array.from(data.sampleQueries).slice(0, 3),
    sampleBody: data.sampleBody,
    sampleResponseSummary: data.sampleResponse ? {
      code: data.sampleResponse.code,
      success: data.sampleResponse.success,
      message: data.sampleResponse.message,
      dataKeys: data.sampleResponse.data ? (typeof data.sampleResponse.data === 'object' ? Object.keys(data.sampleResponse.data) : typeof data.sampleResponse.data) : undefined
    } : null
  });
}

fs.writeFileSync(path.resolve(__dirname, 'har_analysis_result.json'), JSON.stringify(result, null, 2), 'utf8');
console.log('Saved', result.length, 'unique endpoints to har_analysis_result.json');
