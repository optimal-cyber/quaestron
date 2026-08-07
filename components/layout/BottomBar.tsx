export default function BottomBar({ lastUpdated }: { lastUpdated?: string }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-7 bg-surface/90 backdrop-blur-md border-t border-border flex items-center px-3 md:px-4 text-[11px] md:text-[12px] font-mono text-muted gap-2 md:gap-6">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
        <span className="hidden sm:inline">SYSTEMS</span> ACTIVE
      </span>
      <span className="hidden md:inline border-l border-border pl-6">
        <span className="text-accent-gold">●</span> TARGETING
        <span className="mx-3 text-accent-green">●</span> SUPPLYING
        <span className="mx-3 text-accent-blue">●</span> FUNDING
      </span>
      <div className="flex-1" />
      {lastUpdated && <span className="hidden sm:inline">DATA UPDATED: {lastUpdated}</span>}
      <span className="border-l border-border pl-2 md:pl-6">QUAESTRON v1.0</span>
    </div>
  )
}
