/**
 * The page-transition boundary.
 *
 * A `template.tsx` re-mounts on every navigation where a `layout.tsx` persists,
 * which is exactly the hook a route change needs: the shell (header, command
 * palette, assistant, boot provider) stays mounted and keeps its state, while
 * the page inside it gets a fresh mount and therefore a fresh entrance.
 *
 * Why this is a wrapper and not a per-page class: navigation is a property of
 * the app, not of any one page. Twenty-odd pages each remembering to animate
 * themselves is twenty chances to forget — and the seven modules that had never
 * adopted the reveal system are what that looks like in practice.
 *
 * The `flex flex-1 flex-col` is load-bearing, not styling. This element becomes
 * the flex child of `<main className="flex flex-1 flex-col">` in the root
 * layout, so without it every page that fills the viewport height (charts, the
 * knowledge graph, the wire) would collapse to content height instead. Passing
 * the flex context straight through keeps the wrapper invisible to layout.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-enter flex flex-1 flex-col">{children}</div>;
}
