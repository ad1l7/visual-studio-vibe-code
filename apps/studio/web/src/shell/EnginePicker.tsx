import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { MODELS } from '../labels.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, Popover, usePopover } from '../ui/overlay.tsx';
import { useEngine } from './context.tsx';

/** Содержимое выбора движка и модели — и в поповере сайдбара, и в диалоге. */
export function EngineSettings() {
  const { engines, choice, setChoice } = useEngine();
  const name = useId();
  return (
    <div className="engine-settings">
      <div className="engine-settings__title">Кто выполняет работу</div>
      <div role="radiogroup" aria-label="Кто выполняет работу" className="engine-list">
        {engines.length === 0 && <div className="faint small">Загружаю список…</div>}
        {engines.map((e) => (
          <label key={e.id} className={`engine-option ${e.available ? '' : 'engine-option--off'}`}>
            <input type="radio" name={name} checked={choice.engine === e.id} disabled={!e.available} onChange={() => setChoice({ ...choice, engine: e.id })} />
            <span className="engine-option__radio" aria-hidden />
            <span className="engine-option__text">
              <span className="engine-option__name">
                {e.name}
                {e.available && e.version && e.id !== 'mock' && <span className="faint small"> · {e.version}</span>}
              </span>
              <span className="engine-option__hint">{e.available ? (e.id === 'mock' ? 'Имитация работы агентов: удобно, чтобы посмотреть, как всё устроено' : 'Настоящие ИИ-агенты на вашем компьютере') : e.hint ?? 'Не установлен'}</span>
            </span>
          </label>
        ))}
      </div>
      {choice.engine === 'claude-code' && (
        <>
          <div className="engine-settings__title">Модель</div>
          <div role="radiogroup" aria-label="Модель" className="model-list">
            {MODELS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={choice.model === m.id} className="model-option" onClick={() => setChoice({ ...choice, model: m.id })}>
                <span className="model-option__name">{m.label}</span>
                <span className="model-option__hint">{m.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="engine-settings__note">Этот выбор используется и для составления плана, и для работы агентов.</p>
    </div>
  );
}

export function engineLabel(id: string | undefined, name?: string) {
  if (!id) return 'не выбран';
  return name ?? (id === 'mock' ? 'Демо-агенты' : 'Claude Code');
}

/** Строка «Движок: …» внизу сайдбара. */
export function EngineButton({ compact }: { compact?: boolean }) {
  const { current, choice } = useEngine();
  const p = usePopover();
  const label = engineLabel(choice.engine, current?.name);
  const model = choice.engine === 'claude-code' ? MODELS.find((m) => m.id === choice.model)?.label : undefined;
  return (
    <>
      <button
        ref={p.ref}
        type="button"
        className={`engine-btn ${compact ? 'engine-btn--rail' : ''}`}
        onClick={p.toggle}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        aria-label={`Движок и модель: ${label}`}
        data-tip={compact ? `Движок: ${label}` : undefined}
      >
        <span className={`dot ${current?.available ? 'dot--ok' : current ? 'dot--bad' : ''}`} aria-hidden />
        {!compact && (
          <>
            <span className="engine-btn__text ellipsis">
              <span className="faint">Движок:</span> {label}
              {model && model !== 'По умолчанию' ? ` · ${model}` : ''}
            </span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="faint" />
          </>
        )}
      </button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} placement="top" align="start" width={320} label="Движок и модель">
        <EngineSettings />
      </Popover>
    </>
  );
}

export function EngineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Движок и модель" width={380} actions={<Button variant="primary" onClick={onClose} data-autofocus>Готово</Button>}>
      <EngineSettings />
    </Dialog>
  );
}
