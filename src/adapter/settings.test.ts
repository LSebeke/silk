import { describe, expect, it } from 'vitest';
import de from '../../public/lang/de.json';
import en from '../../public/lang/en.json';
import { registerSettings } from './settings';

interface Registered {
  scope: string;
  config: boolean;
  default: unknown;
  name?: string;
  hint?: string;
  choices?: Record<string, string>;
}

function collect() {
  const settings = new Map<string, Registered>();
  registerSettings((namespace, key, data) => {
    expect(namespace).toBe('silk');
    settings.set(key, data as Registered);
  });
  return settings;
}

describe('settings (spec §13)', () => {
  it('registers every §13 setting with its scope and default', () => {
    const s = collect();
    const summary = Object.fromEntries(
      [...s].map(([key, d]) => [key, { scope: d.scope, default: d.default }]),
    );
    expect(summary).toMatchObject({
      materializeMode: { scope: 'world', default: 'immediate' },
      hoodedImage: { scope: 'world', default: 'modules/silk/assets/hooded.svg' },
      playerView: { scope: 'world' },
      viewState: { scope: 'world' },
      detailDrop: { scope: 'client', default: true },
      renderBudgetWarning: { scope: 'client', default: 1000 },
      confirmDelete: { scope: 'client', default: true },
      warnUnmaterializeReveal: { scope: 'client', default: true },
      windowState: { scope: 'client' },
      fileBrowseNoticeShown: { scope: 'world', default: false },
      revealState: { scope: 'world' },
    });
    expect(s.size).toBe(11);
  });

  it('hides internal settings from the config dialog', () => {
    const s = collect();
    const hidden = [...s].filter(([, d]) => !d.config).map(([k]) => k);
    expect(hidden.sort()).toEqual([
      'fileBrowseNoticeShown',
      'playerView',
      'revealState',
      'viewState',
      'windowState',
    ]);
  });

  it('offers immediate and on-demand Materialize modes', () => {
    expect(Object.keys(collect().get('materializeMode')?.choices ?? {})).toEqual([
      'immediate',
      'onDemand',
    ]);
  });

  it('has DE and EN text for every visible setting', () => {
    for (const [key, d] of collect()) {
      if (!d.config) continue;
      for (const lang of [en, de]) {
        expect(lookup(lang, d.name), key).toBeTypeOf('string');
        expect(lookup(lang, d.hint), key).toBeTypeOf('string');
        for (const label of Object.values(d.choices ?? {}))
          expect(lookup(lang, label), label).toBeTypeOf('string');
      }
    }
  });
});

describe('lang files', () => {
  it('DE and EN define the same keys', () => {
    expect(keys(de)).toEqual(keys(en));
  });
});

function lookup(lang: object, path = ''): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], lang);
}

function keys(o: object, prefix = ''): string[] {
  return Object.entries(o)
    .flatMap(([k, v]) =>
      typeof v === 'object' && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    )
    .sort();
}
