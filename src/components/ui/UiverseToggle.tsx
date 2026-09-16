import './uiverse-toggle.css';
import { cn } from './utils';

export type UiverseToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
};

/**
 * Skewed red/blue pill toggle (Uiverse.io by Shoh2008). Button + track only — no native checkbox.
 */
export function UiverseToggle({
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: UiverseToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      id={id}
      className={cn('uiverse-toggle', checked && 'uiverse-toggle--on', className)}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
    >
      <span className="uiverse-toggle-track" aria-hidden />
    </button>
  );
}
