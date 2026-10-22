import { defineConfig } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';

// CJS 互操作兼容：部分环境下 default 会嵌套一层
const uni = uniModule.default ?? uniModule;

export default defineConfig({
  plugins: [uni()]
});
