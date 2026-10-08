import { type RefObject, useEffect, useRef } from 'react';

type CreatorModalProps = {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/** A small dialog with keyboard containment; no modal/UI dependency is required. */
export function CreatorModal({ onClose, returnFocusRef }: CreatorModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const main = document.querySelector('main');
    const mainHadInert = main?.hasAttribute('inert') ?? false;
    const mainHadAriaHidden = main?.hasAttribute('aria-hidden') ?? false;
    const previousAriaHidden = main?.getAttribute('aria-hidden') ?? null;
    const previousBodyOverflow = document.body.style.overflow;

    // The dialog is rendered beside <main>, so inert prevents pointer and keyboard interaction
    // with the editor while a modal decision is open.
    main?.setAttribute('inert', '');
    main?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const items = focusableElements(dialogRef.current);
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (main) {
        if (!mainHadInert) main.removeAttribute('inert');
        if (mainHadAriaHidden) main.setAttribute('aria-hidden', previousAriaHidden ?? 'true');
        else main.removeAttribute('aria-hidden');
      }
      returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-modal-title"
        aria-describedby="creator-modal-description"
        tabIndex={-1}
      >
        <button ref={closeButtonRef} className="modal-close" type="button" aria-label="Close Creator plan details" onClick={onClose}>×</button>
        <p className="eyebrow">CREATOR · PROPOSED</p>
        <h2 id="creator-modal-title">Coming soon—not for sale today.</h2>
        <p id="creator-modal-description">Creator is a future $4.99/month idea for reusable presets, batch processing, and vertical video export. There is no checkout, account, card collection, or paywall in this MVP.</p>
        <p className="modal-note">A future billing build would use server-created checkout sessions, verified payment webhooks, authenticated entitlements, server-only secrets, cancellation/account management, and clear recurring-price disclosure. Browser-only paid locks are not secure enforcement.</p>
        <button className="button primary" type="button" onClick={onClose}>Got it</button>
      </section>
    </div>
  );
}
