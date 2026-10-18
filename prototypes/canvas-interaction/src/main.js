// PROTOTYPE, throwaway: Svelte Flow canvas in a Foundry v14 ApplicationV2 window.
import { mount, unmount } from 'svelte';
import '@xyflow/svelte/dist/style.css';
import './style.css';
import App from './App.svelte';

class SilkCanvasPrototype extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'silk-proto-canvas',
    classes: ['silk-proto-window'],
    window: { title: 'Silk Canvas — PROTOTYPE', resizable: true, icon: 'fa-solid fa-diagram-project' },
    position: { width: Math.min(1500, window.innerWidth - 80), height: Math.min(950, window.innerHeight - 80) },
  };
  #app;
  async _renderHTML() { return null; }
  _replaceHTML(_result, content) { if (!this.#app) this.#app = mount(App, { target: content }); }
  _onClose(options) { if (this.#app) unmount(this.#app); this.#app = null; super._onClose(options); }
}

Hooks.once('ready', () => {
  const open = () => new SilkCanvasPrototype().render({ force: true });
  game.silkProto = { open };
  if (game.user.isGM) open();
});
Hooks.on('renderJournalDirectory', (app, html) => {
  if (!game.user.isGM || html.querySelector('.silk-proto-open')) return;
  const b = Object.assign(document.createElement('button'), { className: 'silk-proto-open', type: 'button', innerHTML: '<i class="fa-solid fa-diagram-project"></i> Silk Canvas (prototype)' });
  b.onclick = () => game.silkProto.open();
  html.querySelector('.header-actions')?.append(b);
});
