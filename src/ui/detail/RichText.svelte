<script lang="ts">
  /**
   * Rich text of a detail window (Info Blocks, Connection Notes; v1.1 §G.1): Foundry's
   * ProseMirror editor, read-only with an always-visible pencil, growing with its content
   * (no nested scroll). Extra attributes (`data-*`) go on the host.
   */
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import type { DetailContext } from './context';

  let {
    mount,
    html,
    save,
    ...rest
  }: {
    mount: DetailContext['editor'];
    html: string;
    save: (html: string) => void;
    [attr: `data-${string}`]: unknown;
  } = $props();

  /**
   * Mounts the editor once per `{#key}` (the text: its own save or an outside edit), not on
   * other changes, which would close an editor that is open.
   */
  const editor =
    (text: string): Attachment<HTMLElement> =>
    (host) =>
      untrack(() => mount(host, text, save));
</script>

{#key html}
  <div class="rich" {...rest} {@attach untrack(() => editor(html))}></div>
{/key}

<style>
  /* Room for the pencil, also when the text is empty. */
  .rich :global(prose-mirror) {
    min-height: 32px;
  }
  .rich :global(prose-mirror.inactive .editor-content) {
    padding-right: calc(var(--form-field-height, 26px) + 4px);
  }
  /* Always visible, not only on hover (#142); hidden while the editor is open. */
  .rich :global(prose-mirror button.toggle:enabled) {
    display: block;
  }
</style>
