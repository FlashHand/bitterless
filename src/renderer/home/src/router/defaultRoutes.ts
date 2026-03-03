import type { RouteRecordRaw } from 'vue-router';

const isDev = import.meta.env.VITE_ENV === 'dev';

const baseRoutes: RouteRecordRaw[] = [
  {
    path: 'chat',
    name: 'chat',
    component: () => import('@/views/chat/Chat.vue'),
    meta: {
      icon: '💬',
    },
  },
  {
    path: 'connector',
    name: 'connector',
    component: () => import('@/views/connector/Connector.vue'),
    meta: {
      icon: '🔗',
    },
  },
  {
    path: 'setting',
    name: 'setting',
    component: () => import('@/views/setting/Setting.vue'),
    meta: {
      icon: '⚙️',
    },
  },
];

const devRoutes: RouteRecordRaw[] = [
  {
    path: 'debug',
    name: 'debug',
    component: () => import('@/views/debug/Debug.vue'),
    meta: {
      icon: '🐛',
    },
  },
];

export const defaultRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/views/layout/Layout.vue'),
    redirect: '/chat',
    children: [...baseRoutes, ...(isDev ? devRoutes : [])],
  },
];
