import { Monitor, Moon, Rows3, Rows4, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { applyDensity, applyTheme, useLocalSetting, type DensitySetting, type ThemeSetting } from '../lib/storage.ts';
import { IconButton } from '../ui/Button.tsx';
import { Menu, usePopover } from '../ui/overlay.tsx';

export const THEME_LABELS: Record<ThemeSetting, string> = { system: 'Как в системе', dark: 'Тёмная', light: 'Светлая' };
export const DENSITY_LABELS: Record<DensitySetting, string> = { normal: 'Обычная', compact: 'Плотная' };

export function useTheme() {
  const [theme, setTheme] = useLocalSetting<ThemeSetting>('vibe.theme', 'system');
  useEffect(() => applyTheme(theme), [theme]);
  return [theme, setTheme] as const;
}

export function useDensity() {
  const [density, setDensity] = useLocalSetting<DensitySetting>('vibe.density', 'normal');
  useEffect(() => applyDensity(density), [density]);
  return [density, setDensity] as const;
}

const THEME_ICON = { system: Monitor, dark: Moon, light: Sun } as const;

export function ThemeMenu({ placement = 'top' }: { placement?: 'top' | 'bottom' }) {
  const [theme, setTheme] = useTheme();
  const p = usePopover();
  return (
    <>
      <IconButton ref={p.ref} icon={THEME_ICON[theme]} label={`Тема: ${THEME_LABELS[theme].toLowerCase()}`} onClick={p.toggle} aria-haspopup="menu" aria-expanded={p.open} />
      <Menu
        open={p.open}
        onClose={p.close}
        anchor={p.anchor}
        placement={placement}
        align="start"
        label="Тема"
        items={(['system', 'dark', 'light'] as ThemeSetting[]).map((t) => ({ label: THEME_LABELS[t], checked: t === theme, icon: THEME_ICON[t], onClick: () => setTheme(t) }))}
      />
    </>
  );
}

export function DensityMenu({ placement = 'top' }: { placement?: 'top' | 'bottom' }) {
  const [density, setDensity] = useDensity();
  const p = usePopover();
  const icon = density === 'compact' ? Rows4 : Rows3;
  return (
    <>
      <IconButton ref={p.ref} icon={icon} label={`Плотность: ${DENSITY_LABELS[density].toLowerCase()}`} onClick={p.toggle} aria-haspopup="menu" aria-expanded={p.open} />
      <Menu
        open={p.open}
        onClose={p.close}
        anchor={p.anchor}
        placement={placement}
        align="start"
        label="Плотность"
        items={(['normal', 'compact'] as DensitySetting[]).map((d) => ({ label: DENSITY_LABELS[d], checked: d === density, icon: d === 'compact' ? Rows4 : Rows3, onClick: () => setDensity(d) }))}
      />
    </>
  );
}
