import { useRef, type ReactNode } from 'react';

/**
 * While `hidden`, keeps showing the children from the last render it was
 * shown with. Handing React the very same elements again makes it skip that
 * whole subtree, so a parked section (Chat behind Home or Apps) no longer
 * re-renders in the background each time its parent does; components inside
 * still update for their own state and stores. Shown again, it renders once
 * with everything current.
 */
export function FreezeWhenHidden({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  const shown = useRef<ReactNode>(children);
  if (!hidden) shown.current = children;
  return shown.current;
}
