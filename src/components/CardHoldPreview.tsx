import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getFlavorById } from '../game/cards';
import { COMBO_GROUP_MEMBERS, getCardGroups } from '../game/effects';
import type { FlavorId } from '../game/types';
import { useI18n } from '../i18n';
import { flavorImageUrl } from './assetPaths';

/** Shows card help only during a stationary press-and-hold. */
export function CardHoldPreview({
  flavorId,
  children,
  onLongPress,
}: {
  flavorId: FlavorId;
  children: ReactNode;
  onLongPress?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!previewRef.current?.contains(target) && !wrapRef.current?.contains(target))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !position) return;
    const cardRect = wrapRef.current?.querySelector('.game-card')?.getBoundingClientRect();
    const preview = previewRef.current;
    if (!cardRect || !preview) return;
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    const left = Math.max(
      12,
      Math.min(window.innerWidth - width - 12, cardRect.left + cardRect.width / 2 - width / 2)
    );
    const above = cardRect.top - height - 12;
    const below = cardRect.bottom + 12;
    const top = above >= 8 ? above : Math.min(below, window.innerHeight - height - 8);
    const next = { left, top: Math.max(8, top) };
    if (Math.abs(next.left - position.left) > 1 || Math.abs(next.top - position.top) > 1)
      setPosition(next);
  }, [open, position]);
  const flavor = getFlavorById(flavorId);
  if (!flavor) return children;
  const name = t.flavors[flavor.id] || flavor.name;
  const groups = getCardGroups(flavorId);

  return (
    <span
      ref={wrapRef}
      className="hold-preview-wrap"
      onPointerDown={(e: ReactPointerEvent<HTMLSpanElement>) => {
        start.current = { x: e.clientX, y: e.clientY };
        longPressed.current = false;
        clear();
        const wrap = e.currentTarget;
        timer.current = window.setTimeout(() => {
          const card = wrap.querySelector('.game-card');
          const rect = card?.getBoundingClientRect();
          if (rect) {
            const maxHeight = Math.min(280, window.innerHeight * 0.5);
            const width = Math.min(340, window.innerWidth - 24);
            const left = Math.max(
              12,
              Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)
            );
            const above = rect.top - maxHeight - 12;
            const below = rect.bottom + 12;
            const top = above >= 8 ? above : Math.min(below, window.innerHeight - maxHeight - 8);
            setPosition({ left, top: Math.max(8, top) });
          }
          longPressed.current = true;
          setOpen(true);
          onLongPress?.();
        }, 650);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) {
          clear();
          setOpen(false);
          start.current = null;
        }
      }}
      onPointerUp={() => {
        clear();
        start.current = null;
      }}
      onPointerCancel={() => {
        clear();
        start.current = null;
        setOpen(false);
      }}
      onClickCapture={(e) => {
        if (longPressed.current) {
          e.preventDefault();
          e.stopPropagation();
          longPressed.current = false;
        }
      }}
    >
      {children}
      {open && position
        ? createPortal(
            <span ref={previewRef} className="card-preview" style={position} role="tooltip">
              <strong className="card-preview-title">{name}</strong>
              <span className="card-preview-effect">{t.cardEffects[flavor.id]}</span>
              {groups.map((group) => (
                <span className="preview-group" key={group}>
                  <span className="preview-members">
                    {COMBO_GROUP_MEMBERS[group].map((memberId) => {
                      const member = getFlavorById(memberId);
                      return member ? (
                        <span className="preview-member" key={memberId}>
                          <img src={flavorImageUrl(member)} alt="" />
                          <small>{t.flavors[memberId] || member.name}</small>
                        </span>
                      ) : null;
                    })}
                  </span>
                </span>
              ))}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
