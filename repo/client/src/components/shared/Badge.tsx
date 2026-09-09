/**
 * Stamped tags on course rows (03-ui-direction.md §3) — rectangular and
 * bordered, not gradient pills.
 */

export type BadgeKind = 'active' | 'archived' | 'sis'

const BADGE: Record<BadgeKind, { text: string; className: string }> = {
  active: { text: 'Active', className: 'badge-active' },
  archived: { text: 'Archived', className: 'badge-archived' },
  sis: { text: 'SIS Roster Shell', className: 'badge-sis' },
}

export function Badge({ kind }: { kind: BadgeKind }) {
  const { text, className } = BADGE[kind]
  return <span className={`badge ${className}`}>{text}</span>
}
