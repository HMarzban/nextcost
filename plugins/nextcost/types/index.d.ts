declare module 'claude-code' {
  interface PluginState {
    'nextcost': {
      /** Whether the band is showing at all. */
      isHidden: boolean
      /** Whether the band is open: its view beneath the collapsed row. */
      isExpanded: boolean
      /** What the band has counted of the conversation `sessionId`, for a
       *  reload of its code to carry on from; null before anything is. */
      kept: Readonly<{ sessionId?: string; cache: Record<string, unknown>; insights: Record<string, unknown>; warned: ReadonlyArray<readonly [string, number]> }> | null
    }
  }
}
