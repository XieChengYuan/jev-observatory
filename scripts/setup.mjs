import { existsSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config.mjs';
if (existsSync(CONFIG)) { console.log('保留已有配置：' + CONFIG); }
else {
  writeFileSync(CONFIG,JSON.stringify({servers:{demo:{name:'Local Echo',command:'${NODE}',args:['${ROOT}/src/demo-server.mjs'],secretEnv:[]}}},null,2),{mode:0o600});
  console.log('已创建本地无密钥示例：' + CONFIG);
}
console.log('下一步：npm run discover，然后 npm start。');
