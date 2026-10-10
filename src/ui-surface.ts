import type { Modal } from "obsidian";

/** Give detached dialogs the same theme tokens as the plugin view. */
export function styleLedgerModal(modal: Modal): void {
  modal.modalEl?.addClass("ledger-design-surface", "ledger-dialog");
  modal.contentEl?.addClass("ledger-design-surface");
}
