// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useRef, useState } from 'react';
import { CreatorModal } from '../src/components/CreatorModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

function Harness() {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button">Creator plan coming soon</button>
      <main><button type="button">Background editor control</button></main>
      {open && <CreatorModal onClose={() => setOpen(false)} returnFocusRef={triggerRef} />}
    </>
  );
}

function pressKey(target: EventTarget, key: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
}

describe('CreatorModal keyboard behavior', () => {
  it('moves focus inside, loops Tab, closes on Escape, restores focus, and inerts the background', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
    });

    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close Creator plan details"]');
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === 'Got it');
    const main = document.querySelector('main');
    expect(close).not.toBeNull();
    expect(confirm).toBeDefined();
    expect(document.activeElement).toBe(close);
    expect(main?.hasAttribute('inert')).toBe(true);

    await act(async () => {
      confirm?.focus();
      pressKey(confirm as HTMLButtonElement, 'Tab');
    });
    expect(document.activeElement).toBe(close);

    await act(async () => {
      close?.focus();
      pressKey(close as HTMLButtonElement, 'Tab', true);
    });
    expect(document.activeElement).toBe(confirm);

    await act(async () => {
      pressKey(document, 'Escape');
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('button'));
    expect(main?.hasAttribute('inert')).toBe(false);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
