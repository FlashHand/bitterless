import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.css';
import 'markstream-vue/index.css';
import '@renderer/common/assets/style/theme.less';
import App from './App.vue';
import router from './router';
import { i18n } from '@renderer/common/i18n/i18n.helper';

createApp(App).use(ArcoVue).use(router).use(i18n).mount('#app');
