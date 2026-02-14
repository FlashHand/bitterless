import type { RouteRecordRaw } from 'vue-router';

export const defaultRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/views/layout/Layout.vue'),
    redirect: '/chat',
    children: [
      {
        path: 'chat',
        name: 'chat',
        component: () => import('@/views/chat/Chat.vue'),
      },
      {
        path: 'debug',
        name: 'debug',
        component: () => import('@/views/debug/Debug.vue'),
      },
    ],
  },
];
