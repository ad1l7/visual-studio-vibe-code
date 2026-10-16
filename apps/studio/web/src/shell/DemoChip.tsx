import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readLS, writeLS } from '../lib/storage.ts';
import { Button } from '../ui/Button.tsx';
import { Popover } from '../ui/overlay.tsx';

/** Чип «Демо» вместо баннера. При первом открытии демо-сборки поповер открыт сам. */
export function DemoChip({ auto }: { auto?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (auto && anchor && !readLS('vibe.demoNoticeSeen', false)) {
      const t = setTimeout(() => setOpen(true), 300);
      return () => clearTimeout(t);
    }
  }, [auto, anchor]);
  if (!__VIBE_DEMO__) return null;
  const close = () => {
    setOpen(false);
    writeLS('vibe.demoNoticeSeen', true);
  };
  return (
    <>
      <button ref={setAnchor} type="button" className="demo-chip" onClick={() => (open ? close() : setOpen(true))} aria-haspopup="dialog" aria-expanded={open}>
        <Info size={14} strokeWidth={1.75} aria-hidden /> Демо
      </button>
      <Popover open={open} onClose={close} anchor={anchor} placement="bottom" align="end" width={320} label="Демо-версия" initialFocus="[data-ok]">
        <div className="demo-note">
          <div className="demo-note__title">Это демо-версия</div>
          <p>Планировщик и агенты здесь имитируются в браузере, код не пишется. Настоящих агентов Claude Code студия запускает у вас на компьютере командой <code>pnpm studio</code>.</p>
          <div className="demo-note__actions">
            <Button size="sm" variant="primary" data-ok onClick={close}>
              Понятно
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
