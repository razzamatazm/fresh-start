export type Phase = 'idle' | 'writing' | 'clearing'

declare module 'claude-code' {
  interface PluginState {
    'fresh-start': { phase: Phase }
  }
}
