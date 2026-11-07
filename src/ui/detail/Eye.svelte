<script lang="ts">
  /** Reveal eye toggle of a detail window (spec §8 Controls). */
  let {
    on,
    enabled,
    localize,
    onclick,
  }: {
    on: boolean;
    /** Reveal is available (an Adventure is checked out). */
    enabled: boolean;
    localize(key: string): string;
    onclick(): void;
  } = $props();
</script>

<button
  type="button"
  class="eye"
  class:on
  disabled={!enabled}
  title={localize(
    enabled ? (on ? 'SILK.Reveal.Unreveal' : 'SILK.Reveal.Reveal') : 'SILK.Reveal.NeedsAdventure',
  )}
  {onclick}
  data-silk-eye={on ? 'on' : 'off'}
  ><i class="fa-solid {on ? 'fa-eye' : 'fa-eye-slash'}"></i></button
>

<style>
  .eye {
    flex: none;
    width: 26px;
    height: 22px;
    padding: 0;
    color: #999;
  }
  .eye.on {
    color: #2b6cb0;
  }
</style>
