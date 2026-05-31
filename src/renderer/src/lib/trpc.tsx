/**
 * tRPC Client 配置
 * 通过 IPC Link 连接主进程的 tRPC router
 */

import { createTRPCProxyClient } from '@trpc/client'
import { ipcLink } from 'electron-trpc-experimental/renderer'
import type { AppRouter } from '../../../main/router'

// 创建 tRPC Proxy Client（直接调用，不需要 React hooks）
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
})

// 导出类型供组件使用
export type { AppRouter }