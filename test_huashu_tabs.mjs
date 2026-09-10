import { BridgeClient } from 'file:///C:/Users/chenahao/AppData/Local/npm-cache/_npx/459c632c3c993076/node_modules/huashu-chrome/src/lib/rpc.js';
import fs from 'node:fs';

async function main() {
  const client = new BridgeClient({ client: 'test-agent' });
  await client.connect({ timeoutMs: 5000 });

  try {
    const data = await client.call('screenshot', {}, { tabId: 846843177 });
    if (data.dataUrl) {
      const [head, b64] = data.dataUrl.split(',');
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync('d:/01_Development/yuannian_batch_test/test_screenshot.jpg', buf);
      console.log('Saved screenshot successfully! Size:', buf.length);
    } else {
      console.log('No dataUrl in response:', Object.keys(data));
    }
  } catch (err) {
    console.error('Failed to take screenshot:', err);
  } finally {
    client.close();
  }
}

main();
