import { Drawer } from '../ui/overlay.tsx';
import { Keys } from '../ui/display.tsx';

const ROWS: [string[], string, string][] = [
  [['mod+k'], 'Палитра команд: найти действие, шаг или проект', 'везде'],
  [['mod+enter'], 'Главная кнопка внизу экрана (кроме «Остановить»)', 'везде'],
  [['alt+1', 'alt+4'], 'Перейти на шаг 1–4 проекта', 'в проекте'],
  [['mod+s'], 'Сохранить план', 'шаг «Команда и план»'],
  [['mod+b'], 'Свернуть или развернуть боковую панель', 'везде'],
  [['Esc'], 'Закрыть верхнее окно: палитру, меню, панель', 'везде'],
  [['j', 'k'], 'Следующая и предыдущая задача', 'панель задачи'],
  [['l'], 'Показать или скрыть ленту событий', 'шаг «Запуск»'],
  [['?'], 'Это окно', 'везде, кроме полей ввода'],
];

export function ShortcutsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} label="Горячие клавиши" title="Горячие клавиши" width={440}>
      <table className="shortcuts">
        <tbody>
          {ROWS.map(([keys, what, where]) => (
            <tr key={what}>
              <td className="shortcuts__keys">
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="faint"> {keys.length === 2 && k.startsWith('alt') ? '…' : '/'} </span>}
                    {k === 'Esc' ? <Keys combo="Esc" /> : <Keys combo={k === 'alt+4' ? '4' : k} />}
                  </span>
                ))}
              </td>
              <td>
                <div>{what}</div>
                <div className="faint small">{where}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint small">Однобуквенные клавиши не срабатывают, пока курсор стоит в поле ввода.</p>
    </Drawer>
  );
}
