/**
 * Registers every custom overlay template exactly once, as a side effect of
 * import. `chart-workspace.tsx` imports this module before creating any
 * chart instance. Built-in klinecharts overlays (trend lines, horizontal
 * line/ray, price channel, Fibonacci, rectangle, brush) need no registration
 * here — only the tools klinecharts doesn't ship.
 */
import "./arrow";
import "./measure";
import "./risk-reward";
import "./pitchfork";
